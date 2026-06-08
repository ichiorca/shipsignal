"""T1 (spec 015) — unit tests for the worker run-status state machine.

Mirrors the TypeScript ``runStatus.test.ts`` so both surfaces agree on the lattice.
Supersedes the spec-001 4-state assertions (queued/running/...).
"""

from __future__ import annotations

import pytest

from release_worker.status import (
    InvalidStatusTransitionError,
    RunStatus,
    assert_transition,
    can_transition,
    is_redundant_advance,
    is_terminal,
    progress_index,
)

# The happy-path progress order (excludes the off-path terminals).
_HAPPY_PATH: tuple[RunStatus, ...] = (
    RunStatus.CREATED,
    RunStatus.COLLECTING_EVIDENCE,
    RunStatus.EVIDENCE_READY,
    RunStatus.FEATURES_PENDING_REVIEW,
    RunStatus.FEATURES_APPROVED,
    RunStatus.GENERATING_ARTIFACTS,
    RunStatus.ARTIFACTS_PENDING_REVIEW,
    RunStatus.ARTIFACTS_APPROVED,
    RunStatus.GENERATING_MEDIA,
    RunStatus.COMPLETED,
)


def test_all_twelve_states_exist() -> None:
    assert len(list(RunStatus)) == 12


def test_full_happy_path_is_legal_one_step_at_a_time() -> None:
    for current, target in zip(_HAPPY_PATH, _HAPPY_PATH[1:], strict=False):
        assert can_transition(current, target), f"{current} -> {target}"


def test_artifacts_approved_may_skip_media_to_completed() -> None:
    assert can_transition(RunStatus.ARTIFACTS_APPROVED, RunStatus.COMPLETED)
    assert can_transition(RunStatus.ARTIFACTS_APPROVED, RunStatus.GENERATING_MEDIA)


def test_failure_and_cancellation_reachable_from_every_non_terminal() -> None:
    for status in RunStatus:
        if is_terminal(status):
            continue
        assert can_transition(status, RunStatus.FAILED), f"{status} -> failed"
        assert can_transition(status, RunStatus.CANCELLED), f"{status} -> cancelled"


def test_steps_cannot_be_skipped_and_terminals_are_final() -> None:
    assert not can_transition(RunStatus.CREATED, RunStatus.COMPLETED)
    assert not can_transition(RunStatus.CREATED, RunStatus.EVIDENCE_READY)
    assert not can_transition(RunStatus.COMPLETED, RunStatus.GENERATING_MEDIA)
    assert not can_transition(RunStatus.FAILED, RunStatus.CREATED)
    assert not can_transition(RunStatus.CANCELLED, RunStatus.COMPLETED)


def test_assert_transition_returns_target_on_legal_move() -> None:
    assert (
        assert_transition(RunStatus.CREATED, RunStatus.COLLECTING_EVIDENCE)
        is RunStatus.COLLECTING_EVIDENCE
    )


def test_assert_transition_raises_on_illegal_move() -> None:
    with pytest.raises(InvalidStatusTransitionError) as excinfo:
        assert_transition(RunStatus.CREATED, RunStatus.COMPLETED)
    assert excinfo.value.current is RunStatus.CREATED
    assert excinfo.value.target is RunStatus.COMPLETED


def test_terminal_states() -> None:
    assert is_terminal(RunStatus.COMPLETED)
    assert is_terminal(RunStatus.FAILED)
    assert is_terminal(RunStatus.CANCELLED)
    assert not is_terminal(RunStatus.CREATED)
    assert not is_terminal(RunStatus.FEATURES_PENDING_REVIEW)


def test_progress_index_orders_happy_path_and_excludes_off_ramps() -> None:
    assert progress_index(RunStatus.CREATED) == 0
    assert progress_index(RunStatus.COMPLETED) == 9
    assert progress_index(RunStatus.FEATURES_APPROVED) > progress_index(
        RunStatus.EVIDENCE_READY
    )
    assert progress_index(RunStatus.FAILED) is None
    assert progress_index(RunStatus.CANCELLED) is None


def test_is_redundant_advance_is_idempotent_under_redispatch() -> None:
    # Same state, or a backward move along the progress path, is a no-op (re-dispatch).
    assert is_redundant_advance(RunStatus.EVIDENCE_READY, RunStatus.EVIDENCE_READY)
    assert is_redundant_advance(
        RunStatus.ARTIFACTS_PENDING_REVIEW, RunStatus.GENERATING_ARTIFACTS
    )
    # A real forward move is NOT redundant.
    assert not is_redundant_advance(
        RunStatus.EVIDENCE_READY, RunStatus.FEATURES_PENDING_REVIEW
    )
    # Off-path terminals are never redundant (they are real, irreversible decisions).
    assert not is_redundant_advance(RunStatus.COLLECTING_EVIDENCE, RunStatus.CANCELLED)
