"""T3/T5 (spec 005) — runtime Aurora adapters for content_generation_graph.

P4 (Storage): approved features, skill snapshots, artifacts, and skill-usage events live
in Aurora. aurora-rules: every statement is parameterised; the connection is the shared
short-lived job connection. Imported only by ``__main__`` at runtime (needs psycopg), so
the unit gate never imports it — the nodes are tested against the in-memory fakes.

constitution §5: ``AuroraApprovedFeatureReader`` returns ONLY ``status='approved'`` rows,
so rejected/edited features can never flow into generation. §9.2: ``AuroraSkillSnapshotSink``
records provenance into Aurora; the canonical skill stays the repo SKILL.md.
"""

from __future__ import annotations

import json

import psycopg

from release_worker.content_models import (
    ApprovedFeature,
    ArtifactDraft,
    SkillSnapshot,
    SkillUsageEvent,
)


def _as_str_tuple(value: object) -> tuple[str, ...]:
    """Coerce a text[]/None column into a tuple of strings (defensive: data at rest)."""
    if not isinstance(value, (list, tuple)):
        return ()
    return tuple(v for v in value if isinstance(v, str))


class AuroraApprovedFeatureReader:
    """Load a run's Gate#1-approved features for generation (PRD §5.3)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def list_approved_features(
        self, release_run_id: str
    ) -> tuple[ApprovedFeature, ...]:
        """Return the run's ``status='approved'`` features only (constitution §5).

        Ordered by id for deterministic prompts + idempotency keys downstream.
        """
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, release_run_id, title, summary_internal, user_value,
                       audiences, change_type, surface_area
                  FROM feature_clusters
                 WHERE release_run_id = %s AND status = 'approved'
                 ORDER BY id
                """,
                (release_run_id,),
            )
            rows = cur.fetchall()

        return tuple(
            ApprovedFeature(
                feature_id=str(row[0]),
                release_run_id=str(row[1]),
                title=row[2],
                summary_internal=row[3] or "",
                user_value=row[4] or "",
                audiences=_as_str_tuple(row[5]),
                change_type=row[6],
                surface_area=_as_str_tuple(row[7]),
            )
            for row in rows
        )


class AuroraSkillSnapshotSink:
    """Upsert ``skill_repo_snapshots`` rows; keep one active per (repo, skill_path)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def upsert_snapshot(self, record: SkillSnapshot) -> str:
        """Insert/refresh the snapshot for (repo, skill_path, commit_sha) and return its
        effective id (the existing row's on a re-snapshot of the same commit).

        Idempotent via ON CONFLICT DO UPDATE so RETURNING always yields the row id. After
        the upsert, prior snapshots of the same skill at *other* commits are deactivated so
        exactly one snapshot is active per (repo, skill_path) (§10.5 is_active).

        The upsert and the deactivation run in ONE explicit transaction: on the autocommit
        connection they would otherwise be two separate commits, so a concurrent re-snapshot of
        the same (repo, skill_path) could have its just-activated row stamped is_active=FALSE by
        the other run's deactivation — leaving the skill invisible to retrieval. The transaction
        makes the activate-and-deactivate atomic."""
        with self._conn.transaction(), self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO skill_repo_snapshots (
                    id, repo, skill_name, skill_path, skill_version, commit_sha,
                    content_hash, frontmatter_json, body_excerpt, is_active
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (repo, skill_path, commit_sha) DO UPDATE
                    SET is_active = TRUE,
                        skill_version = EXCLUDED.skill_version,
                        content_hash = EXCLUDED.content_hash,
                        frontmatter_json = EXCLUDED.frontmatter_json,
                        body_excerpt = EXCLUDED.body_excerpt,
                        synced_at = now()
                RETURNING id
                """,
                (
                    record.snapshot_id,
                    record.repo,
                    record.skill_name,
                    record.skill_path,
                    record.skill_version,
                    record.commit_sha,
                    record.content_hash,
                    json.dumps(record.frontmatter),
                    record.body_excerpt,
                ),
            )
            effective_id = str(cur.fetchone()[0])
            # One active snapshot per (repo, skill_path): deactivate other commits.
            cur.execute(
                """
                UPDATE skill_repo_snapshots
                   SET is_active = FALSE
                 WHERE repo = %s AND skill_path = %s AND commit_sha <> %s
                """,
                (record.repo, record.skill_path, record.commit_sha),
            )
        return effective_id


class AuroraArtifactSink:
    """Persist draft artifacts + their skill-usage provenance (PRD §10.3/§10.5)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def insert_artifact(self, record: ArtifactDraft) -> None:
        # T1 (spec 016) / §18.3 — persist the tamper-evident content_hash alongside the draft so
        # every artifact row carries it from insert (the computed_field is a pure function of the
        # title/body, stable across retries and matching the dashboard/SQL recompute).
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO artifacts (
                    id, release_run_id, feature_id, artifact_type, title,
                    body_markdown, status, model_id, prompt_version, skill_versions_json,
                    content_hash
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    record.artifact_id,
                    record.release_run_id,
                    record.feature_id,
                    record.artifact_type,
                    record.title,
                    record.body_markdown,
                    record.status,
                    record.model_id,
                    record.prompt_version,
                    json.dumps(record.skill_versions),
                    record.content_hash,
                ),
            )

    def record_skill_usage(self, event: SkillUsageEvent) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO skill_usage_events (
                    release_run_id, artifact_id, graph_name, node_name,
                    skill_snapshot_id, skill_name, skill_version, content_hash, usage_type
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    event.release_run_id,
                    event.artifact_id,
                    event.graph_name,
                    event.node_name,
                    event.skill_snapshot_id,
                    event.skill_name,
                    event.skill_version,
                    event.content_hash,
                    event.usage_type,
                ),
            )
