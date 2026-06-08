"""T2/T4/T6 (spec 009) — runtime Aurora adapters for ``skill_learning_graph``.

P4 (Storage): learning signals, staged candidates, promotions, and cooldown suppressions all live
in Aurora (§10.5). aurora-rules: every statement is parameterised; the connection is the shared
short-lived job connection. Imported only by ``__main__`` at runtime (needs psycopg), so the unit
gate never imports it — the nodes are tested against the in-memory fakes.

§9.2 — Aurora is the staging + provenance LEDGER, never the canonical registry:
``AuroraRepoActiveSkillReader`` reads the FULL current body from the checked-out repo file (the
canonical source) and pairs it with the active snapshot's recorded id + content hash; the
candidate body is staged here only as a proposal. The repo file itself is replaced by
``FilesystemRepoSkillWriter`` (the single repo write), never from Aurora.
"""

from __future__ import annotations

import json
from pathlib import Path

import psycopg

from release_worker.skill_learning_models import (
    ActiveSkill,
    LearningSignal,
    PromotionRecord,
    SkillRevisionCandidate,
)


class AuroraLearningSignalSource:
    """Mine a run's recorded Gate #1/#2 review actions into raw learning signals (PRD §9.3 step 4).

    Reads three kinds from what the dashboard already recorded for the run: reviewer EDITS
    (``approvals.decision='edited'`` on an artifact, with the edited body), REJECTED CLAIMS
    (artifact_claims left ``support_status='unsupported'`` — the claims a check/reviewer refused),
    and review NOTES (``approvals.notes``). Each is tagged with the skill snapshots that were
    active for the artifact (via ``skill_usage_events``) so it can be attributed to a skill.
    Returns raw dicts the ``collect_learning_signals`` node validates through ``RawReviewSignal``.
    """

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def collect_review_signals(self, release_run_id: str) -> tuple[object, ...]:
        signals: list[dict[str, object]] = []
        with self._conn.cursor() as cur:
            # Reviewer edits: an 'edited' artifact decision with the edited body_markdown.
            cur.execute(
                """
                SELECT ap.target_id, a.body_markdown,
                       ap.edited_payload_json ->> 'body_markdown', ap.reviewer,
                       COALESCE(
                           ARRAY(
                               SELECT DISTINCT sue.skill_snapshot_id
                                 FROM skill_usage_events sue
                                WHERE sue.artifact_id = a.id
                                  AND sue.skill_snapshot_id IS NOT NULL
                           ),
                           ARRAY[]::uuid[]
                       )
                  FROM approvals ap
                  JOIN artifacts a ON a.id = ap.target_id
                 WHERE ap.target_type = 'artifact'
                   AND ap.decision = 'edited'
                   AND a.release_run_id = %s
                """,
                (release_run_id,),
            )
            for target_id, original, revised, reviewer, snapshot_ids in cur.fetchall():
                signals.append(
                    {
                        "signal_type": "reviewer_edit",
                        "artifact_id": str(target_id),
                        "source_text": original or "",
                        "revised_text": revised or "",
                        "reviewer": reviewer,
                        "related_skill_snapshot_ids": _as_id_tuple(snapshot_ids),
                    }
                )

            # Rejected claims: claims left unsupported on the run's artifacts (the refused claims).
            cur.execute(
                """
                SELECT ac.artifact_id, ac.claim_text, ac.claim_type, ac.risk_level,
                       COALESCE(
                           ARRAY(
                               SELECT DISTINCT sue.skill_snapshot_id
                                 FROM skill_usage_events sue
                                WHERE sue.artifact_id = ac.artifact_id
                                  AND sue.skill_snapshot_id IS NOT NULL
                           ),
                           ARRAY[]::uuid[]
                       )
                  FROM artifact_claims ac
                  JOIN artifacts a ON a.id = ac.artifact_id
                 WHERE a.release_run_id = %s
                   AND ac.support_status = 'unsupported'
                """,
                (release_run_id,),
            )
            for (
                artifact_id,
                claim_text,
                claim_type,
                risk_level,
                snapshot_ids,
            ) in cur.fetchall():
                signals.append(
                    {
                        "signal_type": "rejected_claim",
                        "artifact_id": str(artifact_id),
                        "source_text": claim_text or "",
                        "rejection_category": claim_type or "unsupported_claim",
                        "severity": risk_level,
                        "related_skill_snapshot_ids": _as_id_tuple(snapshot_ids),
                    }
                )

            # Review notes: any reviewer note recorded at Gate #1/#2 for the run's artifacts.
            cur.execute(
                """
                SELECT ap.target_id, ap.notes, ap.reviewer
                  FROM approvals ap
                  JOIN artifacts a ON a.id = ap.target_id
                 WHERE ap.target_type = 'artifact'
                   AND ap.notes IS NOT NULL
                   AND a.release_run_id = %s
                """,
                (release_run_id,),
            )
            for target_id, notes, reviewer in cur.fetchall():
                signals.append(
                    {
                        "signal_type": "review_note",
                        "artifact_id": str(target_id),
                        "source_text": notes or "",
                        "reviewer": reviewer,
                    }
                )
        return tuple(signals)


class AuroraLearningSignalSink:
    """Persist mined ``learning_signals`` rows (PRD §10.5)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def insert_signal(self, signal: LearningSignal) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO learning_signals (
                    id, release_run_id, artifact_id, signal_type, source_text,
                    revised_text, diff_json, reviewer, rejection_category, severity,
                    related_skill_snapshot_ids
                ) VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s)
                """,
                (
                    signal.signal_id,
                    signal.release_run_id,
                    signal.artifact_id,
                    signal.signal_type,
                    signal.source_text,
                    signal.revised_text,
                    json.dumps({k: list(v) for k, v in signal.diff.items()}),
                    signal.reviewer,
                    signal.rejection_category,
                    signal.severity,
                    list(signal.related_skill_snapshot_ids),
                ),
            )


class AuroraRepoActiveSkillReader:
    """Resolve referenced skill snapshots to their active repo skills (PRD §5.5 / §9.2).

    The active snapshot row supplies the recorded id + content hash + version; the FULL current
    body is read from the checked-out repo file at ``skill_path`` (the canonical source). A
    referenced snapshot whose skill has no active snapshot, or whose file is missing, is skipped
    (the graph drafts nothing for it — fail closed). Deduped by ``skill_path``.
    """

    def __init__(self, conn: psycopg.Connection, repo_root: Path) -> None:
        self._conn = conn
        self._repo_root = repo_root

    def active_skills_for_snapshots(
        self, snapshot_ids: tuple[str, ...]
    ) -> tuple[ActiveSkill, ...]:
        if not snapshot_ids:
            return ()
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT repo, skill_path
                  FROM skill_repo_snapshots
                 WHERE id = ANY(%s)
                """,
                (list(snapshot_ids),),
            )
            paths = cur.fetchall()

            actives: dict[str, ActiveSkill] = {}
            for repo, skill_path in paths:
                if skill_path in actives:
                    continue
                cur.execute(
                    """
                    SELECT id, skill_name, skill_version, content_hash
                      FROM skill_repo_snapshots
                     WHERE repo = %s AND skill_path = %s AND is_active
                     ORDER BY synced_at DESC
                     LIMIT 1
                    """,
                    (repo, skill_path),
                )
                row = cur.fetchone()
                if row is None:
                    continue
                content = self._read_body(skill_path)
                if content is None:
                    continue
                actives[skill_path] = ActiveSkill(
                    snapshot_id=str(row[0]),
                    repo=repo,
                    skill_name=row[1],
                    skill_path=skill_path,
                    skill_version=row[2],
                    content=content,
                    content_hash=row[3],
                )
        return tuple(actives.values())

    def _read_body(self, skill_path: str) -> str | None:
        """Read the current SKILL.md body from the checked-out repo, or None if missing."""
        path = self._repo_root / skill_path
        if not path.is_file():
            return None
        text = path.read_text(encoding="utf-8")
        return text or None


class AuroraSuppressionStore:
    """The cooldown gate for near-duplicate rejected candidates (PRD §9.4.7 / §10.5)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def is_suppressed(self, repo: str, skill_name: str, pattern_hash: str) -> bool:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1
                  FROM skill_candidate_suppressions
                 WHERE repo = %s AND skill_name = %s AND pattern_hash = %s
                   AND suppressed_until > now()
                 LIMIT 1
                """,
                (repo, skill_name, pattern_hash),
            )
            return cur.fetchone() is not None

    def add_suppression(
        self,
        repo: str,
        skill_name: str,
        pattern_hash: str,
        rejected_candidate_id: str,
        reason: str,
        cooldown_days: int,
    ) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO skill_candidate_suppressions (
                    repo, skill_name, pattern_hash, rejected_candidate_id,
                    suppressed_until, reason
                ) VALUES (
                    %s, %s, %s, %s, now() + make_interval(days => %s), %s
                )
                """,
                (
                    repo,
                    skill_name,
                    pattern_hash,
                    rejected_candidate_id,
                    cooldown_days,
                    reason,
                ),
            )


class AuroraSkillCandidateSink:
    """Persist staged candidates + record their Gate #3 outcome (PRD §10.5)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def insert_candidate(self, candidate: SkillRevisionCandidate) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO skill_revision_candidates (
                    id, repo, skill_name, skill_path, base_skill_snapshot_id,
                    proposed_version, proposed_body, proposed_frontmatter_json,
                    proposal_reason, miner_type, supporting_signal_ids, confidence,
                    pattern_hash, old_content_hash, status
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    candidate.candidate_id,
                    candidate.repo,
                    candidate.skill_name,
                    candidate.skill_path,
                    candidate.base_skill_snapshot_id,
                    candidate.proposed_version,
                    candidate.proposed_body,
                    json.dumps(candidate.proposed_frontmatter),
                    candidate.proposal_reason,
                    candidate.miner_type,
                    list(candidate.supporting_signal_ids),
                    candidate.confidence,
                    candidate.pattern_hash,
                    candidate.old_content_hash,
                    candidate.status,
                ),
            )

    def mark_promoted(self, record: PromotionRecord) -> None:
        # Records the promotion provenance and flips status to 'promoted'. The old/new content
        # hashes are preserved on the row even though the repo file has been replaced (AC2).
        with self._conn.cursor() as cur:
            cur.execute(
                """
                UPDATE skill_revision_candidates
                   SET status = 'promoted',
                       promoted_commit_sha = %s,
                       old_content_hash = %s,
                       new_content_hash = %s,
                       reviewed_by = %s,
                       reviewed_at = now()
                 WHERE id = %s
                """,
                (
                    record.promoted_commit_sha,
                    record.old_content_hash,
                    record.new_content_hash,
                    record.reviewer,
                    record.candidate_id,
                ),
            )

    def record_rejection(
        self, candidate_id: str, decision: str, reviewer: str | None, reason: str
    ) -> None:
        # The rejected candidate STAYS in Aurora with its reason (§9.4.6); no repo file is written.
        with self._conn.cursor() as cur:
            cur.execute(
                """
                UPDATE skill_revision_candidates
                   SET status = %s,
                       reviewed_by = %s,
                       reviewed_at = now(),
                       review_notes = %s
                 WHERE id = %s
                """,
                (decision, reviewer, reason, candidate_id),
            )


def _as_id_tuple(value: object) -> tuple[str, ...]:
    """Coerce a uuid[]/None column into a tuple of stringified ids (defensive: data at rest)."""
    if not isinstance(value, (list, tuple)):
        return ()
    return tuple(str(v) for v in value if v is not None)
