"""T1 (spec 020) — runtime Aurora adapter for the gate-notification ledger.

P4 (Storage) + aurora-postgresql-rules: the pure dispatch logic (``notifier``) depends only
on the narrow ``GateNotificationLedger`` Protocol; this psycopg implementation is the
durable side over ``gate_notifications`` (migration 0020), imported only by ``__main__``
(the runtime entry point) so the unit gate never needs a DB. Every statement is
parameterised and keyed by (release_run_id, gate) — the AC3 idempotency key.

Idempotent writes (aurora rules): ``record_attempt`` is an UPSERT on the unique key, so a
replayed dispatch reuses the existing row (bumping attempt_count) instead of inserting a
duplicate; ``mark_notified`` stamps ``notified_at`` only once (COALESCE keeps the first
delivery moment — the T5 latency anchor — stable under a redundant re-mark).

P5: rows carry dispatch metadata only — never the message body or the webhook URL (the
URL embeds a credential). The ``last_error`` written here is the notifier's secret-free
machine label (class name / HTTP status), never an exception message.
"""

from __future__ import annotations

import psycopg


class AuroraGateNotificationLedger:
    """``GateNotificationLedger`` over the Aurora ``gate_notifications`` table."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def already_notified(self, release_run_id: str, gate: str) -> bool:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT notified_at IS NOT NULL FROM gate_notifications
                 WHERE release_run_id = %s AND gate = %s
                """,
                (release_run_id, gate),
            )
            row = cur.fetchone()
        return bool(row[0]) if row is not None else False

    def record_attempt(
        self, release_run_id: str, gate: str, status: int | None, error: str | None
    ) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO gate_notifications
                    (release_run_id, gate, attempt_count, last_status, last_error)
                VALUES (%s, %s, 1, %s, %s)
                ON CONFLICT (release_run_id, gate) DO UPDATE
                   SET attempt_count = gate_notifications.attempt_count + 1,
                       last_status   = EXCLUDED.last_status,
                       last_error    = EXCLUDED.last_error,
                       updated_at    = now()
                """,
                (release_run_id, gate, status, error),
            )

    def mark_notified(self, release_run_id: str, gate: str) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                UPDATE gate_notifications
                   SET notified_at = COALESCE(notified_at, now()),
                       updated_at  = now()
                 WHERE release_run_id = %s AND gate = %s
                """,
                (release_run_id, gate),
            )
