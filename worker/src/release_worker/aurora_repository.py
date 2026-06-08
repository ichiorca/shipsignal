"""T5 (spec 001) — psycopg-backed ``ReleaseRunRepository`` for the Actions runner.

P4 (Storage): writes the run lifecycle back to Aurora ``release_runs``. P5 + the
aurora-postgresql rules: the DSN comes only from env (IAM/Secrets Manager in prod),
TLS is required (``sslmode=require`` enforced on the DSN), and every statement is
parameterised. Imported only by ``__main__`` at runtime, so the unit gate never needs
psycopg installed.
"""

from __future__ import annotations

import os

import psycopg

from release_worker.status import (
    RunStatus,
    assert_transition,
    is_redundant_advance,
    is_terminal,
)


def _require_tls(dsn: str) -> str:
    """Reject a plaintext DSN; default to ``sslmode=require`` when unspecified."""
    if "sslmode=disable" in dsn:
        raise ValueError("sslmode=disable is forbidden: TLS to Aurora is mandatory")
    if "sslmode=" not in dsn:
        sep = "&" if "?" in dsn else "?"
        return f"{dsn}{sep}sslmode=require"
    return dsn


def connect_from_env(env_var: str = "DATABASE_URL") -> psycopg.Connection:
    """Open one TLS-required, autocommit connection to Aurora from the env DSN.

    The single short-lived connection is shared by the run repository, the boundary
    reader, and the evidence sink in ``__main__`` (T4, spec 002) so one Actions job
    opens exactly one connection to the pooled endpoint (aurora-postgresql-rules:
    short-lived contexts must not fan out raw connections)."""
    dsn = os.environ.get(env_var)
    if not dsn:
        raise RuntimeError(f"missing required environment variable: {env_var}")
    return psycopg.connect(_require_tls(dsn), autocommit=True)


class AuroraReleaseRunRepository:
    """Durable repository over a short-lived psycopg connection.

    The connection is opened against the pooled/RDS-Proxy endpoint named in
    ``DATABASE_URL`` and closed when the worker process exits — the Actions job is the
    short-lived context the connection-handling rules are written for.
    """

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    @classmethod
    def from_env(cls, env_var: str = "DATABASE_URL") -> AuroraReleaseRunRepository:
        return cls(connect_from_env(env_var))

    def get_status(self, release_run_id: str) -> RunStatus:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT status FROM release_runs WHERE id = %s",
                (release_run_id,),
            )
            row = cur.fetchone()
        if row is None:
            raise KeyError(release_run_id)
        return RunStatus(row[0])

    def set_thread_id(self, release_run_id: str, thread_id: str) -> None:
        """Persist the resumable thread id and stamp ``started_at`` once."""
        with self._conn.cursor() as cur:
            cur.execute(
                """UPDATE release_runs
                       SET langgraph_thread_id = %s,
                           started_at = COALESCE(started_at, now())
                     WHERE id = %s""",
                (thread_id, release_run_id),
            )

    def advance(self, release_run_id: str, target: RunStatus) -> None:
        """Advance the run to ``target``, validating the hop through the lattice.

        Idempotent under re-dispatch (a no-op when the run is already at or past
        ``target`` on the progress path); ``completed_at`` is stamped on a terminal hop.
        Raises ``InvalidStatusTransitionError`` on an illegal out-of-order move.
        """
        current = self.get_status(release_run_id)
        if is_redundant_advance(current, target):
            return
        assert_transition(current, target)
        with self._conn.cursor() as cur:
            if is_terminal(target):
                cur.execute(
                    "UPDATE release_runs SET status = %s, completed_at = now() "
                    "WHERE id = %s",
                    (target.value, release_run_id),
                )
            else:
                cur.execute(
                    "UPDATE release_runs SET status = %s WHERE id = %s",
                    (target.value, release_run_id),
                )

    def mark_failed(self, release_run_id: str) -> None:
        """Best-effort terminal-fail used by the entry point's error path."""
        with self._conn.cursor() as cur:
            cur.execute(
                """UPDATE release_runs
                       SET status = %s,
                           completed_at = now()
                     WHERE id = %s""",
                (RunStatus.FAILED.value, release_run_id),
            )

    def close(self) -> None:
        self._conn.close()
