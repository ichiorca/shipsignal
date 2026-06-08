"""T1 (spec 015) — AC: the worker advances a run through the §13.2 lifecycle.

Exercises the release_intelligence lifecycle nodes — the exact callables the compiled
graph wraps (see ``graph.build_release_intelligence_graph``) — against the in-memory
repository, so the tests hit the public surface the runtime invokes (anti-pattern #4).
Supersedes the spec-001 ``run_passthrough`` tests.
"""

from __future__ import annotations

import pytest

from release_worker.feature_models import GateDecision
from release_worker.nodes import (
    begin_run,
    finalize_gate1,
    mark_evidence_ready,
    mark_features_pending_review,
)
from release_worker.repository import (
    InMemoryReleaseRunRepository,
    UnknownReleaseRunError,
)
from release_worker.state import ReleaseRunState
from release_worker.status import InvalidStatusTransitionError, RunStatus


def _seeded() -> tuple[InMemoryReleaseRunRepository, ReleaseRunState]:
    repo = InMemoryReleaseRunRepository()
    repo.seed_created("run-1")
    state = ReleaseRunState(release_run_id="run-1", thread_id="lg_thread_xyz")
    return repo, state


def _walk_to_pending(
    repo: InMemoryReleaseRunRepository, state: ReleaseRunState
) -> ReleaseRunState:
    state = begin_run(state, repo)
    state = mark_evidence_ready(state, repo)
    return mark_features_pending_review(state, repo)


def test_begin_run_moves_created_to_collecting_and_persists_thread_id() -> None:
    repo, state = _seeded()

    result = begin_run(state, repo)

    assert result.status is RunStatus.COLLECTING_EVIDENCE
    assert repo.get_status("run-1") is RunStatus.COLLECTING_EVIDENCE
    assert repo.thread_ids["run-1"] == "lg_thread_xyz"


def test_lifecycle_walks_through_the_early_progress_states_in_order() -> None:
    repo, state = _seeded()

    _walk_to_pending(repo, state)

    assert repo.get_status("run-1") is RunStatus.FEATURES_PENDING_REVIEW
    assert repo.transitions["run-1"] == [
        RunStatus.COLLECTING_EVIDENCE,
        RunStatus.EVIDENCE_READY,
        RunStatus.FEATURES_PENDING_REVIEW,
    ]


def test_finalize_gate1_approved_advances_to_features_approved() -> None:
    repo, state = _seeded()
    state = _walk_to_pending(repo, state)
    approved = state.model_copy(update={"gate_decision": GateDecision.APPROVED})

    result = finalize_gate1(approved, repo)

    assert result.status is RunStatus.FEATURES_APPROVED
    assert repo.get_status("run-1") is RunStatus.FEATURES_APPROVED


def test_finalize_gate1_rejected_cancels_the_run() -> None:
    repo, state = _seeded()
    state = _walk_to_pending(repo, state)
    rejected = state.model_copy(update={"gate_decision": GateDecision.REJECTED})

    result = finalize_gate1(rejected, repo)

    assert result.status is RunStatus.CANCELLED
    assert repo.get_status("run-1") is RunStatus.CANCELLED


def test_finalize_gate1_edited_stays_pending_for_re_review() -> None:
    repo, state = _seeded()
    state = _walk_to_pending(repo, state)
    edited = state.model_copy(update={"gate_decision": GateDecision.EDITED})

    result = finalize_gate1(edited, repo)

    assert result.status is RunStatus.FEATURES_PENDING_REVIEW
    assert repo.get_status("run-1") is RunStatus.FEATURES_PENDING_REVIEW


def test_finalize_gate1_without_a_decision_raises() -> None:
    repo, state = _seeded()
    state = _walk_to_pending(repo, state)
    with pytest.raises(ValueError, match="without a gate decision"):
        finalize_gate1(state, repo)


def test_advance_is_idempotent_under_redispatch() -> None:
    repo, state = _seeded()
    _walk_to_pending(repo, state)
    before = list(repo.transitions["run-1"])

    # Re-running begin_run on a run already past collecting_evidence is a no-op,
    # not an illegal-transition error (idempotent re-dispatch).
    begin_run(state, repo)

    assert repo.get_status("run-1") is RunStatus.FEATURES_PENDING_REVIEW
    assert repo.transitions["run-1"] == before


def test_begin_run_does_not_mutate_input_state() -> None:
    repo, state = _seeded()

    begin_run(state, repo)

    assert state.status is RunStatus.CREATED


def test_begin_run_raises_on_unknown_run() -> None:
    repo = InMemoryReleaseRunRepository()
    state = ReleaseRunState(release_run_id="missing", thread_id="lg_thread_xyz")
    with pytest.raises(UnknownReleaseRunError):
        begin_run(state, repo)


def test_advance_rejects_an_out_of_order_jump() -> None:
    repo, state = _seeded()
    # From created, jumping straight to features_pending_review skips two steps.
    with pytest.raises(InvalidStatusTransitionError):
        repo.advance("run-1", RunStatus.FEATURES_PENDING_REVIEW)
