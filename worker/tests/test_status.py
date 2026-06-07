"""T5 (spec 001) — unit tests for the worker run-status state machine.

Mirrors the TypeScript ``runStatus.test.ts`` so both surfaces agree on the lattice.
"""

from __future__ import annotations

import pytest

from release_worker.status import (
    InvalidStatusTransitionError,
    RunStatus,
    assert_transition,
    can_transition,
    is_terminal,
)


def test_happy_path_queued_running_completed_is_legal() -> None:
    assert can_transition(RunStatus.QUEUED, RunStatus.RUNNING)
    assert can_transition(RunStatus.RUNNING, RunStatus.COMPLETED)


def test_failure_is_reachable_from_queued_and_running() -> None:
    assert can_transition(RunStatus.QUEUED, RunStatus.FAILED)
    assert can_transition(RunStatus.RUNNING, RunStatus.FAILED)


def test_illegal_transitions_are_rejected() -> None:
    assert not can_transition(RunStatus.QUEUED, RunStatus.COMPLETED)
    assert not can_transition(RunStatus.COMPLETED, RunStatus.RUNNING)
    assert not can_transition(RunStatus.FAILED, RunStatus.RUNNING)


def test_assert_transition_returns_target_on_legal_move() -> None:
    assert assert_transition(RunStatus.QUEUED, RunStatus.RUNNING) is RunStatus.RUNNING


def test_assert_transition_raises_on_illegal_move() -> None:
    with pytest.raises(InvalidStatusTransitionError) as excinfo:
        assert_transition(RunStatus.QUEUED, RunStatus.COMPLETED)
    assert excinfo.value.current is RunStatus.QUEUED
    assert excinfo.value.target is RunStatus.COMPLETED


def test_terminal_states() -> None:
    assert is_terminal(RunStatus.COMPLETED)
    assert is_terminal(RunStatus.FAILED)
    assert not is_terminal(RunStatus.QUEUED)
    assert not is_terminal(RunStatus.RUNNING)
