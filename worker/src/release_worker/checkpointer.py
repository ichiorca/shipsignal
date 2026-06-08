"""T1 (spec 017) — durable LangGraph checkpointer selection (PRD §3.1 / §5.6).

The §3.1 runtime split runs each phase as a *separate* GitHub Actions invocation, and §5.6
requires a reviewer to "resume the same thread_id" after a gate. The in-process
``MemorySaver`` LangGraph compiles by default cannot satisfy that: its checkpoints die with
the process, so the resume invocation finds no thread to continue. This module is the seam
that makes resume durable — it points LangGraph's checkpointer at Aurora so a thread written
by the initial invocation is still there for the separate resume invocation.

constitution §3: we do NOT reimplement the checkpointer — the durable store is LangGraph's
own ``PostgresSaver`` over Aurora. This module only owns the *selection* (which backend, from
which DSN) and the wiring. Aurora-rules: TLS is mandatory and the DSN comes only from env.

The DSN-resolution helpers are pure (no psycopg / no langgraph import) so the unit gate — which
installs neither — can prove the selection logic: a configured run picks the durable backend,
an unconfigured one falls back to in-process. ``build_checkpointer`` lazy-imports langgraph
only on the runtime path, mirroring how the graph modules keep langgraph out of the gate.
"""

from __future__ import annotations

import os
from collections.abc import Mapping

# Same env var the Aurora repository/connection use (aurora_repository.connect_from_env),
# so the durable checkpointer lands in the SAME cluster as the run's other state — one
# source of truth, no second DSN to keep in sync.
CHECKPOINT_DSN_ENV_VAR = "DATABASE_URL"


def _require_tls(dsn: str) -> str:
    """Reject a plaintext DSN; default to ``sslmode=require`` when unspecified.

    A deliberate small copy of the repository's TLS guard (constitution: TLS to Aurora is
    mandatory). It is reimplemented here rather than imported because the source module pulls
    in psycopg at import time, which would break this module's use in the langgraph/psycopg-
    free unit gate.
    """
    if "sslmode=disable" in dsn:
        raise ValueError("sslmode=disable is forbidden: TLS to Aurora is mandatory")
    if "sslmode=" not in dsn:
        sep = "&" if "?" in dsn else "?"
        return f"{dsn}{sep}sslmode=require"
    return dsn


def resolve_checkpoint_dsn(env: Mapping[str, str] | None = None) -> str | None:
    """The libpq DSN the durable checkpointer should use, or ``None`` for in-process.

    Returns ``None`` when no DSN is configured (dev/test, or a graph run that does not need
    cross-process resume) so the caller falls back to ``MemorySaver``. When a DSN is present
    it is TLS-hardened and the SQLAlchemy ``+psycopg`` driver tag is stripped — LangGraph's
    ``PostgresSaver`` takes a plain libpq connection string, not a SQLAlchemy URL.
    """
    source = env if env is not None else os.environ
    dsn = source.get(CHECKPOINT_DSN_ENV_VAR)
    if not dsn:
        return None
    dsn = dsn.replace("postgresql+psycopg://", "postgresql://", 1)
    return _require_tls(dsn)


def wants_durable_checkpointer(env: Mapping[str, str] | None = None) -> bool:
    """Whether a durable (cross-process) checkpointer is configured for this environment."""
    return resolve_checkpoint_dsn(env) is not None


def build_checkpointer(env: Mapping[str, str] | None = None) -> object:
    """Return the checkpointer to compile the graphs with (runtime; lazy-imports langgraph).

    With a DSN configured: a LangGraph ``PostgresSaver`` over Aurora, ``.setup()``-ed so its
    checkpoint tables exist — this is what makes resume survive a separate process invocation
    (PRD §5.6). Without one: the in-process ``MemorySaver`` (dev/test; resume only within a
    single process). The saver is returned uninstantiated-as-context-manager: ``from_conn_string``
    yields a context manager, so we enter it and keep it open for the life of the short-lived
    Actions job (the job exits, releasing the connection).
    """
    dsn = resolve_checkpoint_dsn(env)
    if dsn is None:
        from langgraph.checkpoint.memory import MemorySaver

        return MemorySaver()

    from langgraph.checkpoint.postgres import PostgresSaver

    saver_cm = PostgresSaver.from_conn_string(dsn)
    saver = saver_cm.__enter__()
    saver.setup()
    return saver
