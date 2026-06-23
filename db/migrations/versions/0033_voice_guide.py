"""voice_guide: structured, authored brand-voice knowledge (singleton)

Closes a gap in the brand brain (migration 0025): "in your voice" was grounded only by EXAMPLE
posts (``company_voice_exemplars``) — there was no place to author the company's voice *rules* as
first-class knowledge. Tone, reading level, do/don't rules, and a preferred/avoided vocabulary lived
implicitly in the repo ``brand-voice`` SKILL.md, not as operator-editable config.

This adds a single ``voice_guide`` row (one company — constitution §2 single-org tool, like the rest
of the brand brain) the worker renders into the generation prompt alongside the retrieved exemplars
(``release_worker.voice_context.format_voice_context``). It is CONFIG/DATA the operator authors on
the Brand Voice page, not a skill (constitution §1/§9.2: skills stay repo-authored).

Singleton: the PK is pinned to ``'default'`` by a CHECK so there is at most one guide, and the row
is seeded empty on upgrade so reads always find one (the app UPDATEs it in place; it never inserts).

Real DDL — not a stub; the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0033_voice_guide"
down_revision: str | None = "0032_capability_skill_map"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE voice_guide (
            id            TEXT PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
            tone          TEXT NOT NULL DEFAULT '',
            reading_level TEXT NOT NULL DEFAULT '',
            do_rules      TEXT[] NOT NULL DEFAULT '{}',
            dont_rules    TEXT[] NOT NULL DEFAULT '{}',
            prefer_terms  TEXT[] NOT NULL DEFAULT '{}',
            avoid_terms   TEXT[] NOT NULL DEFAULT '{}',
            notes         TEXT NOT NULL DEFAULT '',
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # Seed the empty singleton so reads always return a row (the app UPDATEs, never INSERTs).
    op.execute("INSERT INTO voice_guide (id) VALUES ('default');")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS voice_guide;")
