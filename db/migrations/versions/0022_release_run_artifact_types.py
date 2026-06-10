"""release_runs.artifact_types — per-run artifact-type selection

Revision ID: 0022_release_run_artifact_types
Revises: 0021_engagement_metrics
Create Date: 2026-06-09

T1 (spec 022) — every run now carries WHICH of the six §8.1 artifact types it should
generate. The column is a TEXT[] constrained BY THE DB to a non-empty subset of the
closed §8.1 vocabulary (`<@` against the literal six), so an application bug can never
persist an unknown or empty selection — mirroring the CHECK-constraint discipline of
trigger_type/status (migration 0001). Deferred §8.2 types are rejected by construction.

Backfill: ADD COLUMN ... NOT NULL DEFAULT '{all six}' rewrites existing rows with the
full set (PG 11+ fills existing rows from the DEFAULT), which preserves today's
behaviour — every pre-selection run generated all six. The DEFAULT also covers writers
that predate the column; new code always supplies the selection explicitly.

Immutability (spec AC: "immutable after run creation") is owned by the application
layer — no UPDATE path touches this column; the DB guards the value space.

P4 (Storage): the column lives on release_runs, the run-scoped tenancy root.
Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0022_release_run_artifact_types"
down_revision: str | None = "0021_engagement_metrics"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The closed §8.1 set, in canonical order (matches app/lib/artifactTypes.ts and the
# worker's _ARTIFACT_SPECS).
_ALL_SIX = (
    "release_blog",
    "changelog_entry",
    "sales_onepager",
    "linkedin_post",
    "demo_script",
    "release_audio_digest",
)


def upgrade() -> None:
    all_six_literal = ", ".join(_ALL_SIX)
    quoted = ", ".join(f"'{t}'" for t in _ALL_SIX)
    op.execute(
        f"""
        ALTER TABLE release_runs
            ADD COLUMN artifact_types TEXT[] NOT NULL
                DEFAULT '{{{all_six_literal}}}'::text[]
                CHECK (
                    cardinality(artifact_types) >= 1
                    AND artifact_types <@ ARRAY[{quoted}]::text[]
                );
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE release_runs DROP COLUMN IF EXISTS artifact_types;")
