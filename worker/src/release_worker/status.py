"""T5 (spec 001) — release-run status state machine for the LangGraph worker.

P1 (Substrate): LangGraph owns control flow; this module just encodes the legal
status lattice so the worker, API, and dashboard agree. It mirrors the TypeScript
``app/lib/runStatus.ts`` exactly. Pure stdlib so the unit gate imports it without
langgraph/psycopg installed.
"""

from __future__ import annotations

from enum import StrEnum


class RunStatus(StrEnum):
    """The subset of PRD §13.2 statuses the skeleton run lifecycle uses."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


# Legal forward transitions: queued -> running -> terminal; failure from either
# non-terminal state.
_TRANSITIONS: dict[RunStatus, frozenset[RunStatus]] = {
    RunStatus.QUEUED: frozenset({RunStatus.RUNNING, RunStatus.FAILED}),
    RunStatus.RUNNING: frozenset({RunStatus.COMPLETED, RunStatus.FAILED}),
    RunStatus.COMPLETED: frozenset(),
    RunStatus.FAILED: frozenset(),
}


class InvalidStatusTransitionError(ValueError):
    """Raised when a caller attempts an illegal run-status transition."""

    def __init__(self, current: RunStatus, target: RunStatus) -> None:
        self.current = current
        self.target = target
        super().__init__(f"illegal run-status transition: {current} -> {target}")


def is_terminal(status: RunStatus) -> bool:
    """True iff no further transition is legal from ``status``."""
    return len(_TRANSITIONS[status]) == 0


def can_transition(current: RunStatus, target: RunStatus) -> bool:
    """True iff ``target`` is a legal successor of ``current``."""
    return target in _TRANSITIONS[current]


def assert_transition(current: RunStatus, target: RunStatus) -> RunStatus:
    """Return ``target`` if the transition is legal, else raise.

    Raises:
        InvalidStatusTransitionError: if ``current -> target`` is not allowed.
    """
    if not can_transition(current, target):
        raise InvalidStatusTransitionError(current, target)
    return target
