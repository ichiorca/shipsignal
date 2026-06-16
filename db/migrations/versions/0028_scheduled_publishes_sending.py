"""scheduled_publishes: add 'sending' claim status (at-most-once drain)

Revision ID: 0028_scheduled_publishes_sending
Revises: 0027_scheduled_publishes
Create Date: 2026-06-16

Staff-review fix (P0-2): the Phase-4 drain selected `pending` rows, POSTed to the channel, then
marked `sent` — so a crash (or a failed mark) AFTER a successful send left the row `pending`, and
the next cron re-selected and re-published it (duplicate public post; X/LinkedIn have no dedupe).
This adds a `sending` intermediate status so the drain can CLAIM a row (pending → sending, under
`FOR UPDATE SKIP LOCKED`) before dispatching. A crashed send leaves the row `sending` (never
re-selected) — at-most-once instead of at-least-once. The trade is a row possibly stuck `sending`
on crash (operator requeue), which is the safe direction for a public post.

Real DDL — widens the status CHECK only; existing rows are untouched. Clean inverse (any `sending`
rows are reset to `pending` on downgrade so they remain drainable under the old contract).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0028_scheduled_publishes_sending"
down_revision: str | None = "0027_scheduled_publishes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CHECK = "scheduled_publishes_status_check"


def _set_status_check(values: tuple[str, ...]) -> None:
    quoted = ", ".join(f"'{v}'" for v in values)
    op.execute(f"ALTER TABLE scheduled_publishes DROP CONSTRAINT IF EXISTS {_CHECK};")
    op.execute(
        f"ALTER TABLE scheduled_publishes "
        f"ADD CONSTRAINT {_CHECK} CHECK (status IN ({quoted}));"
    )


def upgrade() -> None:
    _set_status_check(("pending", "sending", "sent", "failed", "cancelled"))


def downgrade() -> None:
    # Reset any in-flight claims back to pending so they satisfy the narrower contract.
    op.execute(
        "UPDATE scheduled_publishes SET status = 'pending' WHERE status = 'sending';"
    )
    _set_status_check(("pending", "sent", "failed", "cancelled"))
