"""T1/T2/T3 (spec 013) — runtime Aurora adapters for the product-evaluation layer.

P4 (Storage) + aurora-postgresql-rules: the pure eval logic (``eval_metrics``, ``eval_rubric``)
depends only on narrow Protocols; these psycopg implementations are the durable side, imported
only by ``__main__`` (the runtime entry point) so the unit gate never needs a DB. Every
statement is parameterised and scoped by ``release_run_id`` (constitution §2). The persisted
row carries scores + aggregate counts only — never a prompt, evidence, or model output (§5),
matching the ``eval_runs`` schema (migration 0012).

* ``AuroraEvalSink`` (T1) — INSERT one ``EvalRun``.
* ``AuroraMetricInputsReader`` (T2) — aggregate a run's claim/feature/media/skill/approval
  state into the deterministic ``MetricInputs`` (counts + edit-distance/latency samples).
* ``AuroraApprovedArtifactReader`` (T3) — the approved artifact bodies the LLM-as-judge rubric
  scores (read at eval time; the body enters the prompt, never the eval row).
"""

from __future__ import annotations

import json

import psycopg

from release_worker.eval_metrics import MetricInputs, normalized_edit_distance
from release_worker.eval_models import EvalRun
from release_worker.eval_rubric import ArtifactBody

# A claim is "unsupported" for §17.1 if it is not grounded OR carries high launch risk
# (PRD §17.1: "Claims with no valid evidence or high risk").
_UNSUPPORTED = "unsupported"
_HIGH_RISK = "high"
# Statuses that count a skill candidate as "accepted" (PRD §13.3 skill candidate model).
_ACCEPTED_CANDIDATE_STATUSES = ("approved", "promoted")
# A demo capture that completed without manual repair (PRD §17.1 media success rate).
_READY_MEDIA = "ready"


class AuroraEvalSink:
    """``EvalRunSink`` over the Aurora ``eval_runs`` table (migration 0012)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def record(self, eval_run: EvalRun) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO eval_runs (
                    release_run_id, artifact_id, eval_type, score,
                    rubric_json, findings_json
                ) VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    eval_run.release_run_id,
                    eval_run.artifact_id,
                    eval_run.eval_type,
                    eval_run.score,
                    json.dumps(eval_run.rubric),
                    json.dumps(eval_run.findings),
                ),
            )


class AuroraMetricInputsReader:
    """Aggregate one run's persisted state into the deterministic ``MetricInputs`` (PRD §17.1).

    Scoped to one ``release_run_id`` (no cross-run bleed, §2). Each query returns counts or a
    bounded sample (edit-distance text, approval timestamps) — the reader computes the
    edit-distance ratios HERE and discards the underlying text, so only numbers ever leave this
    boundary toward the eval row (§5). Skill-candidate acceptance is repo-global (candidates
    carry no run id, §10.5), recorded against the triggering run with that caveat in findings.
    """

    def __init__(self, conn: psycopg.Connection, release_run_id: str) -> None:
        self._conn = conn
        self._release_run_id = release_run_id

    def read(self) -> MetricInputs:
        return MetricInputs(
            total_claims=self._scalar(
                """
                SELECT count(*) FROM artifact_claims c
                  JOIN artifacts a ON a.id = c.artifact_id
                 WHERE a.release_run_id = %s
                """
            ),
            claims_with_evidence=self._scalar(
                """
                SELECT count(DISTINCT c.id) FROM artifact_claims c
                  JOIN artifacts a ON a.id = c.artifact_id
                  JOIN claim_evidence_links l ON l.claim_id = c.id
                 WHERE a.release_run_id = %s
                """
            ),
            unsupported_claims=self._scalar(
                """
                SELECT count(*) FROM artifact_claims c
                  JOIN artifacts a ON a.id = c.artifact_id
                 WHERE a.release_run_id = %s
                   AND (c.support_status = %s OR c.risk_level = %s)
                """,
                (self._release_run_id, _UNSUPPORTED, _HIGH_RISK),
            ),
            total_features=self._scalar(
                "SELECT count(*) FROM feature_clusters WHERE release_run_id = %s"
            ),
            rejected_features=self._scalar(
                """
                SELECT count(*) FROM feature_clusters
                 WHERE release_run_id = %s AND status = 'rejected'
                """
            ),
            total_skill_candidates=self._global_scalar(
                "SELECT count(*) FROM skill_revision_candidates"
            ),
            accepted_skill_candidates=self._global_scalar(
                "SELECT count(*) FROM skill_revision_candidates WHERE status = ANY(%s)",
                (list(_ACCEPTED_CANDIDATE_STATUSES),),
            ),
            total_media=self._scalar(
                "SELECT count(*) FROM media_assets WHERE release_run_id = %s"
            ),
            ready_media=self._scalar(
                "SELECT count(*) FROM media_assets WHERE release_run_id = %s AND status = %s",
                (self._release_run_id, _READY_MEDIA),
            ),
            edit_distances=self._edit_distances(),
            approval_latencies_seconds=self._approval_latencies(),
        )

    def _scalar(self, sql: str, params: tuple[object, ...] | None = None) -> int:
        """Run a run-scoped count. Defaults the single param to the run id for the common case."""
        with self._conn.cursor() as cur:
            cur.execute(sql, params if params is not None else (self._release_run_id,))
            row = cur.fetchone()
        return int(row[0]) if row and row[0] is not None else 0

    def _global_scalar(self, sql: str, params: tuple[object, ...] | None = None) -> int:
        """Run a repo-global count (skill candidates are not run-scoped, §10.5)."""
        with self._conn.cursor() as cur:
            cur.execute(sql, params if params is not None else ())
            row = cur.fetchone()
        return int(row[0]) if row and row[0] is not None else 0

    def _edit_distances(self) -> tuple[float, ...]:
        """Per reviewer-edited artifact: the normalized edit distance between the generated and
        revised text (PRD §17.1 edit distance = "how much reviewers rewrite"). The text is
        already redacted (it lives in ``learning_signals``, written post-redaction, §5) and is
        reduced to a ratio HERE — the text never reaches the eval row."""
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT source_text, revised_text FROM learning_signals
                 WHERE release_run_id = %s
                   AND source_text IS NOT NULL AND revised_text IS NOT NULL
                """,
                (self._release_run_id,),
            )
            rows = cur.fetchall()
        return tuple(normalized_edit_distance(row[0], row[1]) for row in rows)

    def _approval_latencies(self) -> tuple[float, ...]:
        """Seconds from each artifact's creation to its approval (PRD §17.1 approval latency).
        Computed in SQL from the artifact ``created_at`` and the approval ``created_at``."""
        with self._conn.cursor() as cur:
            cur.execute(
                """
                -- DISTINCT ON keeps one latency per artifact (its FIRST approval), so duplicate
                -- re-submitted approval rows (approvals has no UNIQUE) don't skew the average.
                SELECT DISTINCT ON (a.id)
                       EXTRACT(EPOCH FROM (ap.created_at - a.created_at))
                  FROM approvals ap
                  JOIN artifacts a ON a.id = ap.target_id
                 WHERE ap.target_type = 'artifact'
                   AND ap.decision = 'approved'
                   AND a.release_run_id = %s
                 ORDER BY a.id, ap.created_at ASC
                """,
                (self._release_run_id,),
            )
            rows = cur.fetchall()
        # Guard against a clock-skewed negative interval; latency is non-negative by definition.
        return tuple(max(0.0, float(row[0])) for row in rows if row[0] is not None)


class AuroraApprovedArtifactReader:
    """Surface a run's Gate#2-approved artifact bodies for the LLM-as-judge rubric (T3).

    Scoped to one ``release_run_id`` (§2). Only artifacts the human approved are scored — the
    rubric judges shipped quality, not drafts. The body enters the rubric *prompt*; it never
    enters the persisted eval row (§5)."""

    def __init__(self, conn: psycopg.Connection, release_run_id: str) -> None:
        self._conn = conn
        self._release_run_id = release_run_id

    def approved_artifacts(self) -> tuple[ArtifactBody, ...]:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, artifact_type, COALESCE(title, ''), COALESCE(body_markdown, '')
                  FROM artifacts
                 WHERE release_run_id = %s AND status = 'approved'
                 ORDER BY id
                """,
                (self._release_run_id,),
            )
            rows = cur.fetchall()
        return tuple(
            ArtifactBody(
                artifact_id=str(row[0]),
                artifact_type=row[1],
                title=row[2],
                body_markdown=row[3],
            )
            for row in rows
        )
