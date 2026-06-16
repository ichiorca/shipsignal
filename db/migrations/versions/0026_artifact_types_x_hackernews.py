"""widen artifact_types to include x_post + hackernews_post

Revision ID: 0026_artifact_types_x_hackernews
Revises: 0025_brand_customer_brain
Create Date: 2026-06-15

Path B / Phase 2 (operator decision 2026-06-15): `x_post` and `hackernews_post` join the artifact
set so the product writes for the public channels named in the tagline ("Blog, LinkedIn, Hacker
News, X"). The release_runs.artifact_types CHECK (last widened to EIGHT in migration 0023) is
widened to the closed TEN, in lockstep with app/lib/artifactTypes.ts and the worker's
ARTIFACT_TYPES. Existing rows are untouched (an eight-type selection is a valid subset of ten).
Deferred §8.2 types (incl. autopublished_assets) stay rejected by construction — generating HN/X
*content* is in scope; autopublishing it is not.

Real DDL — not a stub (anti-pattern #1); the downgrade restores the eight-type contract (no data
rewrite needed either way: every eight-type value satisfies the ten-type CHECK, and the downgrade
only blocks NEW rows using the two new types).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0026_artifact_types_x_hackernews"
down_revision: str | None = "0025_brand_customer_brain"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EIGHT = (
    "release_blog",
    "changelog_entry",
    "sales_onepager",
    "linkedin_post",
    "demo_script",
    "release_audio_digest",
    "customer_email",
    "battlecard_delta",
)
_TEN = (*_EIGHT, "x_post", "hackernews_post")

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
    _set_contract(_TEN)


def downgrade() -> None:
    _set_contract(_EIGHT)
