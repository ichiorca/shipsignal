"""approvals.dedupe_state: two-phase publish/dispatch marker (in-flight vs completed)

The idempotent dispatch routes (channel publish, Slack/GitHub-release announce) record their
dedupe marker BEFORE the outward call so a double-click cannot double-post. The original design
treated the marker's mere existence as "already published": a concurrent request that arrived
while the first call was still dispatching saw the unique-key conflict and returned a
``published: true`` success — even though, if that first dispatch then FAILED and rolled the
marker back, nothing had actually been sent. That is a false success reported to a human.

This adds a nullable ``dedupe_state`` so the marker can carry its phase:
  * ``'pending'``   — inserted before dispatch; a concurrent caller must NOT claim success,
                      it returns "in flight, retry" instead.
  * ``'completed'`` — set after the outward call succeeds; a later replay is a genuine
                      idempotent success.
On dispatch failure the row is deleted (as before), so a retry can re-acquire the marker.

``NULL`` is the legacy value for every pre-existing row and for the non-two-phase idempotent
callers (manifest resume, skill candidate, media trigger) that still use
``recordApprovalIdempotent``: those treat a conflict as "already actioned" exactly as before, so
this column is purely additive and backward-compatible.

Real DDL — not a stub; the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0036_approvals_dedupe_state"
down_revision: str | None = "0035_agent_capabilities"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE approvals
            ADD COLUMN dedupe_state TEXT
                CHECK (dedupe_state IN ('pending', 'completed'));
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE approvals DROP COLUMN IF EXISTS dedupe_state;")
