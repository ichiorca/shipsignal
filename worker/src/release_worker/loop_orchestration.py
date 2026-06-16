"""T1 (spec 012) — single source of truth for the full end-to-end loop.

P1 (Substrate): orchestration is LangGraph only — this module does NOT run any graph or
own any state. It owns the *handoff contract* that chains the four graphs into the one
reproducible loop the constitution's Definition of Done (§8) requires:

    release_intelligence  →  Gate #1 (feature manifest)
        content_generation →  Gate #2 (generated artifacts)
            media_generation →  (no gate — its demo_script is already Gate#2-approved)
                skill_learning →  Gate #3 (skill replacement)

Every phase is keyed to the SAME ``release_run_id`` (constitution §2: no cross-run bleed),
and each phase derives a DETERMINISTIC ``thread_id`` from ``(release_run_id, phase)``. That
determinism is the resume-robustness guarantee (spec 012 T2): re-dispatching a phase for a
run reconstructs the *same* LangGraph thread, so resume is idempotent re-entry from the
checkpoint rather than a fork — the operator never has to copy a random thread id around
(PRD §5.6 "resume the same thread_id").

This is pure logic (an Enum + dicts + string derivation), so the unit gate exercises the
handoff contract directly without importing langgraph/boto3 (see
``worker/tests/test_loop_orchestration.py``).

Two distinct consumers, deliberately:

* ``__main__`` (runtime) imports ONLY ``phase_from_graph`` + ``thread_id_for`` — it runs one
  ``--graph`` phase per invocation and mints that phase's deterministic thread id. It does NOT
  walk the sequence itself: phase-to-phase chaining is performed by the CI dispatch layer
  (each phase is a separate Actions job), one ``--graph`` at a time.
* ``LOOP_SEQUENCE`` / ``next_phase`` / ``gate_number`` / ``GATE_NUMBER`` are the *declarative*
  loop contract — the canonical, in-code statement of the constitution §8 order and the
  three-gate map. They are consumed by the DoD verification test
  (``worker/tests/test_dod_verification.py``), which asserts the loop's shape matches §8; they
  are intentionally not called on the runtime path. Keep them in sync with the CI dispatch
  order — they are the source of truth that the DoD gate checks the pipeline against.
"""

from __future__ import annotations

import re
from enum import StrEnum


class LoopPhase(StrEnum):
    """One phase of the end-to-end loop. Values match the worker's ``--graph`` choices so
    the CLI arg and the handoff contract never drift apart."""

    RELEASE_INTELLIGENCE = "release_intelligence"
    CONTENT_GENERATION = "content_generation"
    MEDIA_GENERATION = "media_generation"
    SKILL_LEARNING = "skill_learning"


# The loop runs strictly in this order (constitution §8 Definition of Done). Index in this
# tuple defines the handoff sequence; ``next_phase`` walks it.
LOOP_SEQUENCE: tuple[LoopPhase, ...] = (
    LoopPhase.RELEASE_INTELLIGENCE,
    LoopPhase.CONTENT_GENERATION,
    LoopPhase.MEDIA_GENERATION,
    LoopPhase.SKILL_LEARNING,
)

# The human gate each phase halts at, or ``None`` for a phase with no gate. Exactly three
# gates exist (constitution §5: feature manifest, generated artifacts, skill replacement);
# media_generation has none because its demo_script is already Gate#2-approved.
GATE_NUMBER: dict[LoopPhase, int | None] = {
    LoopPhase.RELEASE_INTELLIGENCE: 1,
    LoopPhase.CONTENT_GENERATION: 2,
    LoopPhase.MEDIA_GENERATION: None,
    LoopPhase.SKILL_LEARNING: 3,
}

# ``release_run_id`` is a UUID from a trusted internal row, but it is threaded into a
# checkpoint key, so we still validate its shape at this boundary (P5 / coding-standards:
# validate at boundaries) before deriving a thread id from it.
_RUN_ID_RE = re.compile(r"\A[0-9a-zA-Z][0-9a-zA-Z._-]{0,127}\Z")


def phase_from_graph(graph_name: str) -> LoopPhase:
    """Map a ``--graph`` CLI value to its loop phase. Raises on an unknown name (fail
    closed — a new graph must be registered here before it can run)."""
    try:
        return LoopPhase(graph_name)
    except ValueError as err:
        raise ValueError(f"unknown loop graph: {graph_name!r}") from err


def gate_number(phase: LoopPhase) -> int | None:
    """The human gate this phase halts at (1/2/3) or ``None`` if it runs straight through."""
    return GATE_NUMBER[phase]


def next_phase(phase: LoopPhase) -> LoopPhase | None:
    """The phase the loop hands off to after ``phase`` resolves, or ``None`` at the end."""
    index = LOOP_SEQUENCE.index(phase)
    if index + 1 < len(LOOP_SEQUENCE):
        return LOOP_SEQUENCE[index + 1]
    return None


def thread_id_for(release_run_id: str, phase: LoopPhase) -> str:
    """Deterministic LangGraph thread id for ``(release_run_id, phase)``.

    Same inputs → same id, so an initial run and its later resume land on the *same*
    checkpointed thread without the operator carrying a random id between dispatches
    (PRD §5.6). Distinct per phase so the four graphs never collide on one run's checkpoint.
    """
    if not _RUN_ID_RE.match(release_run_id):
        raise ValueError("release_run_id is empty or has an unexpected shape")
    return f"lg_{release_run_id}_{phase.value}"
