"""widen artifact_types to include customer_email + battlecard_delta

Revision ID: 0023_artifact_types_customer_email_battlecard
Revises: 0022_release_run_artifact_types
Create Date: 2026-06-09

Operator decision 2026-06-09 (PRD §8.1 updated in the same change): `customer_email` and
`battlecard_delta` join the initial artifact set. The release_runs.artifact_types CHECK
(migration 0022) pinned the closed six; this widens both the CHECK and the column DEFAULT
to the new closed EIGHT, in lockstep with app/lib/artifactTypes.ts and the worker's
ARTIFACT_TYPES. Existing rows are untouched (a six-type selection is a valid subset of
eight). Remaining §8.2 deferred types stay rejected by construction.

Real DDL — not a stub (anti-pattern #1); the downgrade restores the six-type contract
(no data rewrite needed in either direction: every six-type value satisfies the
eight-type CHECK, and the downgrade would only block NEW rows using the new types).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0023_artifact_types_customer_email_battlecard"
down_revision: str | None = "0022_release_run_artifact_types"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_SIX = (
    "release_blog",
    "changelog_entry",
    "sales_onepager",
    "linkedin_post",
    "demo_script",
    "release_audio_digest",
)
_EIGHT = (*_SIX, "customer_email", "battlecard_delta")

# The 0022 column CHECK was created unnamed on ADD COLUMN; PostgreSQL auto-names it
# <table>_<column>_check.
_CHECK_NAME = "release_runs_artifact_types_check"


def _set_contract(types: tuple[str, ...]) -> None:
    quoted = ", ".join(f"'{t}'" for t in types)
    literal = ", ".join(types)
    op.execute(f"ALTER TABLE release_runs DROP CONSTRAINT IF EXISTS {_CHECK_NAME};")
    op.execute(
        f"""
        ALTER TABLE release_runs
            ADD CONSTRAINT {_CHECK_NAME} CHECK (
                cardinality(artifact_types) >= 1
                AND artifact_types <@ ARRAY[{quoted}]::text[]
            );
        """
    )
    op.execute(
        f"ALTER TABLE release_runs ALTER COLUMN artifact_types "
        f"SET DEFAULT '{{{literal}}}'::text[];"
    )


def upgrade() -> None:
    _set_contract(_EIGHT)


def downgrade() -> None:
    _set_contract(_SIX)
