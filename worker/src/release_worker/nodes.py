"""T5 (spec 001) — the no-op pass-through node of ``release_intelligence_graph``.

P1 (Substrate): LangGraph owns the control flow; this node is the unit of work it
schedules. The skeleton node does exactly what spec 001 requires and nothing more:
move the run ``queued -> running`` (persisting ``langgraph_thread_id``), then
``running -> completed``. Every transition is validated through the shared status
lattice so an out-of-order run can never be silently advanced.

The node is a pure function of ``(state, repository)`` — no global state, no direct
DB or langgraph import — so it is unit-tested against ``InMemoryReleaseRunRepository``
through the exact surface the graph invokes (anti-pattern #4: no private-helper test).
"""

from __future__ import annotations

from release_worker.repository import ReleaseRunRepository
from release_worker.state import ReleaseRunState
from release_worker.status import RunStatus, assert_transition


def run_passthrough(
    state: ReleaseRunState,
    repository: ReleaseRunRepository,
) -> ReleaseRunState:
    """Advance a queued run to completed, persisting the thread id along the way.

    Reads the authoritative current status from the repository (the DB is the source
    of truth, not the in-flight graph state) and validates each hop before writing it.

    Returns:
        A new ``ReleaseRunState`` with ``status == completed``.

    Raises:
        InvalidStatusTransitionError: if the persisted run is not in a state from
            which ``running`` then ``completed`` are legal.
    """
    current = repository.get_status(state.release_run_id)

    assert_transition(current, RunStatus.RUNNING)
    repository.mark_running(state.release_run_id, state.thread_id)

    assert_transition(RunStatus.RUNNING, RunStatus.COMPLETED)
    repository.mark_completed(state.release_run_id)

    return state.model_copy(update={"status": RunStatus.COMPLETED})
