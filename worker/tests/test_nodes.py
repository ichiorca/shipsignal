"""T5 (spec 001) — AC: the worker's pass-through node moves a run running->completed
and writes ``langgraph_thread_id`` back to the store.

Exercises ``run_passthrough`` — the exact callable the compiled graph wraps as its
node (see ``graph.build_release_intelligence_graph``) — against the in-memory
repository, so the test hits the public surface the runtime invokes (anti-pattern #4).
"""

from __future__ import annotations

import pytest

from release_worker.nodes import run_passthrough
from release_worker.repository import (
    InMemoryReleaseRunRepository,
    UnknownReleaseRunError,
)
from release_worker.state import ReleaseRunState
from release_worker.status import RunStatus


def test_passthrough_advances_queued_run_to_completed() -> None:
    repo = InMemoryReleaseRunRepository()
    repo.seed_queued("run-1")
    state = ReleaseRunState(release_run_id="run-1", thread_id="lg_thread_xyz")

    result = run_passthrough(state, repo)

    assert result.status is RunStatus.COMPLETED
    assert repo.get_status("run-1") is RunStatus.COMPLETED
    assert "run-1" in repo.running_marked
    assert "run-1" in repo.completed_marked


def test_passthrough_persists_langgraph_thread_id() -> None:
    repo = InMemoryReleaseRunRepository()
    repo.seed_queued("run-1")
    state = ReleaseRunState(release_run_id="run-1", thread_id="lg_thread_xyz")

    run_passthrough(state, repo)

    assert repo.thread_ids["run-1"] == "lg_thread_xyz"


def test_passthrough_does_not_mutate_input_state() -> None:
    repo = InMemoryReleaseRunRepository()
    repo.seed_queued("run-1")
    state = ReleaseRunState(release_run_id="run-1", thread_id="lg_thread_xyz")

    run_passthrough(state, repo)

    assert state.status is RunStatus.QUEUED


def test_passthrough_rejects_already_completed_run() -> None:
    repo = InMemoryReleaseRunRepository()
    repo.seed_queued("run-1")
    state = ReleaseRunState(release_run_id="run-1", thread_id="lg_thread_xyz")
    run_passthrough(state, repo)  # now completed

    from release_worker.status import InvalidStatusTransitionError

    with pytest.raises(InvalidStatusTransitionError):
        run_passthrough(state, repo)


def test_passthrough_raises_on_unknown_run() -> None:
    repo = InMemoryReleaseRunRepository()
    state = ReleaseRunState(release_run_id="missing", thread_id="lg_thread_xyz")
    with pytest.raises(UnknownReleaseRunError):
        run_passthrough(state, repo)
