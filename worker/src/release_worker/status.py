"""T1 (spec 015) — release-run status state machine for the LangGraph worker.

P1 (Substrate): LangGraph owns control flow; this module just encodes the legal
status lattice so the worker, API, and dashboard agree. It mirrors the TypeScript
``app/lib/runStatus.ts`` exactly. Pure stdlib so the unit gate imports it without
langgraph/psycopg installed.

Supersedes the spec-001 4-state skeleton (queued/running/completed/failed): the run now
models the full PRD §13.2 lifecycle and the worker advances it one step at a time as each
graph progresses (``advance`` on the repository validates every hop through this lattice).
"""

from __future__ import annotations

from enum import StrEnum


class RunStatus(StrEnum):
    """The full PRD §13.2 release lifecycle, in canonical progress order."""

    CREATED = "created"
    COLLECTING_EVIDENCE = "collecting_evidence"
    EVIDENCE_READY = "evidence_ready"
    FEATURES_PENDING_REVIEW = "features_pending_review"
    FEATURES_APPROVED = "features_approved"
    GENERATING_ARTIFACTS = "generating_artifacts"
    ARTIFACTS_PENDING_REVIEW = "artifacts_pending_review"
    ARTIFACTS_APPROVED = "artifacts_approved"
    GENERATING_MEDIA = "generating_media"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# The happy-path progress states in order. ``failed``/``cancelled`` are off-path
# terminals, not points on the linear lifecycle, so they are excluded here.
_PROGRESS_ORDER: tuple[RunStatus, ...] = (
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

# Every non-terminal state may fail or be cancelled out-of-band.
_OFF_RAMP: frozenset[RunStatus] = frozenset({RunStatus.FAILED, RunStatus.CANCELLED})

# Legal forward (happy-path) successors. ``artifacts_approved`` may skip straight to
# ``completed`` when a run generates no demo media. Terminals have no successors.
_FORWARD: dict[RunStatus, frozenset[RunStatus]] = {
    RunStatus.CREATED: frozenset({RunStatus.COLLECTING_EVIDENCE}),
    RunStatus.COLLECTING_EVIDENCE: frozenset({RunStatus.EVIDENCE_READY}),
    RunStatus.EVIDENCE_READY: frozenset({RunStatus.FEATURES_PENDING_REVIEW}),
    RunStatus.FEATURES_PENDING_REVIEW: frozenset({RunStatus.FEATURES_APPROVED}),
    RunStatus.FEATURES_APPROVED: frozenset({RunStatus.GENERATING_ARTIFACTS}),
    RunStatus.GENERATING_ARTIFACTS: frozenset({RunStatus.ARTIFACTS_PENDING_REVIEW}),
    RunStatus.ARTIFACTS_PENDING_REVIEW: frozenset({RunStatus.ARTIFACTS_APPROVED}),
    RunStatus.ARTIFACTS_APPROVED: frozenset(
        {RunStatus.GENERATING_MEDIA, RunStatus.COMPLETED}
    ),
    RunStatus.GENERATING_MEDIA: frozenset({RunStatus.COMPLETED}),
    RunStatus.COMPLETED: frozenset(),
    RunStatus.FAILED: frozenset(),
    RunStatus.CANCELLED: frozenset(),
}


class InvalidStatusTransitionError(ValueError):
    """Raised when a caller attempts an illegal run-status transition."""

    def __init__(self, current: RunStatus, target: RunStatus) -> None:
        self.current = current
        self.target = target
        super().__init__(f"illegal run-status transition: {current} -> {target}")


def is_terminal(status: RunStatus) -> bool:
    """True iff no further transition is legal from ``status``."""
    return status is RunStatus.COMPLETED or status in _OFF_RAMP


def _successors(status: RunStatus) -> frozenset[RunStatus]:
    """Legal next states: happy-path successors plus the off-ramp, unless terminal."""
    if is_terminal(status):
        return frozenset()
    return _FORWARD[status] | _OFF_RAMP


def progress_index(status: RunStatus) -> int | None:
    """Position of ``status`` on the linear progress path, or ``None`` for the off-path
    terminals (``failed``/``cancelled``).

    Lets the repository make advancement idempotent under re-dispatch: advancing to a
    state the run has already passed is a no-op rather than an illegal-transition error.
    """
    try:
        return _PROGRESS_ORDER.index(status)
    except ValueError:
        return None


def can_transition(current: RunStatus, target: RunStatus) -> bool:
    """True iff ``target`` is a legal successor of ``current``."""
    return target in _successors(current)


def assert_transition(current: RunStatus, target: RunStatus) -> RunStatus:
    """Return ``target`` if the transition is legal, else raise.

    Raises:
        InvalidStatusTransitionError: if ``current -> target`` is not allowed.
    """
    if not can_transition(current, target):
        raise InvalidStatusTransitionError(current, target)
    return target


def is_redundant_advance(current: RunStatus, target: RunStatus) -> bool:
    """True iff advancing ``current -> target`` should be a no-op rather than a move.

    Idempotency for re-dispatch (P5 / the codebase's retry discipline): a re-run of a
    graph for a run already at or past ``target`` on the progress path must not fail. A
    same-state advance, or a backward move along the linear path, is redundant. Off-path
    terminals never count as redundant (they are real, irreversible decisions).
    """
    if current is target:
        return True
    ci, ti = progress_index(current), progress_index(target)
    return ci is not None and ti is not None and ci > ti
