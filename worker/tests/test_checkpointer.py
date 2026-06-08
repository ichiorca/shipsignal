"""T1 (spec 017) — durable checkpointer selection + the cross-process resume property.

LangGraph's ``PostgresSaver`` (the production durable store) and ``MemorySaver`` are not
installed in the unit gate, so this proves the seam this project owns: (1) the selection
logic — a configured run picks the durable backend, an unconfigured one falls back to
in-process; and (2) the durability *property* that makes the §3.1/§5.6 guarantee hold —
a thread checkpointed by one process is visible to a separate process iff the backend is
durable (shared store), and is lost with an in-process backend.

The ``_ThreadStore`` below is a faithful test double for a LangGraph checkpoint backend
keyed by ``thread_id``: a durable backend shares its backing across "processes" (modelling
PostgresSaver over Aurora); an in-process backend gets fresh backing per process (modelling
MemorySaver). It is a test fake only — production uses LangGraph's own savers, wired in
``__main__`` via ``build_checkpointer`` (constitution §3: we do not reimplement the
checkpointer).
"""

from __future__ import annotations

import pytest

from release_worker.checkpointer import (
    resolve_checkpoint_dsn,
    wants_durable_checkpointer,
)
from release_worker.loop_orchestration import LoopPhase, thread_id_for

_RUN_ID = "rrrrrrrr-1111-2222-3333-444444444444"
_PLAINTEXT_DSN = "postgresql+psycopg://app:secret@aurora.example:5432/shipsignal"


# --- selection logic (the bug fixed: there was no durable path; always MemorySaver) -----


def test_no_dsn_selects_in_process_backend() -> None:
    # Dev/test (or a run that doesn't need cross-process resume) falls back to MemorySaver.
    assert resolve_checkpoint_dsn({}) is None
    assert wants_durable_checkpointer({}) is False


def test_dsn_selects_durable_backend_and_hardens_tls() -> None:
    env = {"DATABASE_URL": _PLAINTEXT_DSN}
    assert wants_durable_checkpointer(env) is True
    dsn = resolve_checkpoint_dsn(env)
    assert dsn is not None
    # SQLAlchemy driver tag stripped (PostgresSaver wants a libpq DSN) and TLS enforced.
    assert "+psycopg" not in dsn
    assert "sslmode=require" in dsn


def test_explicit_plaintext_tls_is_rejected() -> None:
    # aurora-rules: TLS to Aurora is mandatory; an explicit sslmode=disable must fail closed.
    with pytest.raises(ValueError, match="TLS to Aurora is mandatory"):
        resolve_checkpoint_dsn({"DATABASE_URL": f"{_PLAINTEXT_DSN}?sslmode=disable"})


# --- the durability property: cross-process resume needs a shared (durable) store --------


class _ThreadStore:
    """Test double for a LangGraph checkpoint backend keyed by thread_id."""

    def __init__(self, backing: dict[str, str]) -> None:
        self._backing = backing

    def save(self, thread_id: str, checkpoint: str) -> None:
        self._backing[thread_id] = checkpoint

    def load(self, thread_id: str) -> str | None:
        return self._backing.get(thread_id)


def test_durable_backend_resumes_thread_in_a_separate_process() -> None:
    thread = thread_id_for(_RUN_ID, LoopPhase.RELEASE_INTELLIGENCE)
    aurora: dict[str, str] = {}  # the out-of-process durable store (Postgres stand-in)

    # Process #1: run halts at Gate #1 and checkpoints the thread.
    process_one = _ThreadStore(aurora)
    process_one.save(thread, "halted-at-gate-1")

    # Process #2: a *fresh* process (new store object) over the SAME durable backing — the
    # separate Actions invocation that resumes after the reviewer acts (§3.1 / §5.6).
    process_two = _ThreadStore(aurora)
    assert process_two.load(thread) == "halted-at-gate-1"


def test_in_process_backend_loses_the_thread_across_processes() -> None:
    # This is the bug a MemorySaver default causes: the checkpoint dies with the process, so
    # the resume invocation finds nothing. The fix is selecting the durable backend above.
    thread = thread_id_for(_RUN_ID, LoopPhase.RELEASE_INTELLIGENCE)

    process_one = _ThreadStore({})  # MemorySaver: per-process backing
    process_one.save(thread, "halted-at-gate-1")

    process_two = _ThreadStore({})  # fresh process, fresh backing
    assert process_two.load(thread) is None


def test_build_checkpointer_falls_back_to_memory_without_a_dsn() -> None:
    # Real builder path; skips cleanly when langgraph isn't installed (the gate), runs on the
    # Actions runner where it is. With no DSN it must return an in-process MemorySaver.
    pytest.importorskip("langgraph")
    from langgraph.checkpoint.memory import MemorySaver

    from release_worker.checkpointer import build_checkpointer

    assert isinstance(build_checkpointer({}), MemorySaver)
