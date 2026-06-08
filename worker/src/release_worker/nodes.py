"""T1 (spec 015) — the release_intelligence_graph status-lifecycle nodes.

P1 (Substrate): LangGraph owns the control flow; these are the units of work it
schedules. They advance the run through the early PRD §13.2 lifecycle states and
finalize it at Gate #1, validating every hop through the shared status lattice so an
out-of-order run can never be silently advanced.

Each node is a pure function of ``(state, repository)`` — no global state, no direct DB
or langgraph import — so they are unit-tested against ``InMemoryReleaseRunRepository``
through the exact surface the graph invokes (anti-pattern #4: no private-helper test).

Supersedes the spec-001 ``run_passthrough`` skeleton (queued→running→completed): the run
now walks created → collecting_evidence → evidence_ready → features_pending_review and is
finalized at the gate to features_approved (approved) or cancelled (rejected).
"""

from __future__ import annotations

from release_worker.feature_models import GateDecision
from release_worker.repository import ReleaseRunRepository
from release_worker.state import ReleaseRunState
from release_worker.status import RunStatus


def begin_run(
    state: ReleaseRunState, repository: ReleaseRunRepository
) -> ReleaseRunState:
    """Persist the resumable thread id and move the run created → collecting_evidence.

    Idempotent under re-dispatch (``advance`` no-ops if the run is already past
    collecting_evidence on the progress path).

    Raises:
        InvalidStatusTransitionError: if the persisted run cannot legally enter
            ``collecting_evidence`` (e.g. it is already terminal).
    """
    repository.set_thread_id(state.release_run_id, state.thread_id)
    repository.advance(state.release_run_id, RunStatus.COLLECTING_EVIDENCE)
    return state.model_copy(update={"status": RunStatus.COLLECTING_EVIDENCE})


def mark_evidence_ready(
    state: ReleaseRunState, repository: ReleaseRunRepository
) -> ReleaseRunState:
    """Move the run collecting_evidence → evidence_ready (evidence persisted)."""
    repository.advance(state.release_run_id, RunStatus.EVIDENCE_READY)
    return state.model_copy(update={"status": RunStatus.EVIDENCE_READY})


def mark_features_pending_review(
    state: ReleaseRunState, repository: ReleaseRunRepository
) -> ReleaseRunState:
    """Move the run evidence_ready → features_pending_review (manifest persisted).

    The graph halts at the Gate #1 interrupt with the run in this state; nothing
    downstream runs until a human resolves the gate (constitution §5).
    """
    repository.advance(state.release_run_id, RunStatus.FEATURES_PENDING_REVIEW)
    return state.model_copy(update={"status": RunStatus.FEATURES_PENDING_REVIEW})


def finalize_gate1(
    state: ReleaseRunState, repository: ReleaseRunRepository
) -> ReleaseRunState:
    """Finalize the release-intelligence run at Gate #1 from the human decision.

    Reached only after the interrupt resolves, so a run halted at the gate never
    auto-advances (constitution §5 — no self-approval):

    * approved → features_approved (content generation, a separate graph, takes over).
    * rejected → cancelled (the run ends; no content is generated).
    * edited   → stays features_pending_review (a no-op advance) for re-review.

    Raises:
        ValueError: if reached without a resolved gate decision (guarded by routing).
    """
    if state.gate_decision is None:  # pragma: no cover - guarded by graph routing
        raise ValueError("finalize_gate1 reached without a gate decision")

    if state.gate_decision is GateDecision.APPROVED:
        target = RunStatus.FEATURES_APPROVED
    elif state.gate_decision is GateDecision.REJECTED:
        target = RunStatus.CANCELLED
    else:  # EDITED — a re-review is required; the run stays pending (advance no-ops).
        target = RunStatus.FEATURES_PENDING_REVIEW

    repository.advance(state.release_run_id, target)
    return state.model_copy(update={"status": target})
