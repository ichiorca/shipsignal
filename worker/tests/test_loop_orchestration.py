"""T1 (spec 012) — the end-to-end loop handoff contract.

Exercises the pure orchestration module the runtime entry point uses to chain the four
graphs and mint per-phase thread ids. Keeps the unit gate free of langgraph/boto3 — only
the handoff logic is under test (constitution §6: pure logic is unit-tested directly).
"""

from __future__ import annotations

import pytest

from release_worker.loop_orchestration import (
    GATE_NUMBER,
    LOOP_SEQUENCE,
    LoopPhase,
    gate_number,
    next_phase,
    phase_from_graph,
    thread_id_for,
)

_RUN_ID = "rrrrrrrr-1111-2222-3333-444444444444"


def test_loop_sequence_is_the_four_graphs_in_dod_order() -> None:
    # constitution §8 Definition of Done: the loop runs intel → content → media → skill.
    assert LOOP_SEQUENCE == (
        LoopPhase.RELEASE_INTELLIGENCE,
        LoopPhase.CONTENT_GENERATION,
        LoopPhase.MEDIA_GENERATION,
        LoopPhase.SKILL_LEARNING,
    )


def test_exactly_three_human_gates_exist() -> None:
    # constitution §5: three mandatory gates (manifest, artifacts, skill) — and media has none.
    gated = [p for p in LOOP_SEQUENCE if GATE_NUMBER[p] is not None]
    assert [gate_number(p) for p in gated] == [1, 2, 3]
    assert gate_number(LoopPhase.MEDIA_GENERATION) is None


def test_phase_from_graph_round_trips_every_cli_choice() -> None:
    for phase in LoopPhase:
        assert phase_from_graph(phase.value) is phase


def test_phase_from_graph_fails_closed_on_unknown() -> None:
    with pytest.raises(ValueError, match="unknown loop graph"):
        phase_from_graph("autopublish")  # a non-goal graph must not resolve


def test_next_phase_walks_the_sequence_then_stops() -> None:
    assert next_phase(LoopPhase.RELEASE_INTELLIGENCE) is LoopPhase.CONTENT_GENERATION
    assert next_phase(LoopPhase.CONTENT_GENERATION) is LoopPhase.MEDIA_GENERATION
    assert next_phase(LoopPhase.MEDIA_GENERATION) is LoopPhase.SKILL_LEARNING
    assert next_phase(LoopPhase.SKILL_LEARNING) is None


def test_thread_id_is_deterministic_per_run_and_phase() -> None:
    # PRD §5.6: same (run, phase) → same thread, so resume re-enters the same checkpoint.
    first = thread_id_for(_RUN_ID, LoopPhase.CONTENT_GENERATION)
    again = thread_id_for(_RUN_ID, LoopPhase.CONTENT_GENERATION)
    assert first == again == f"lg_{_RUN_ID}_content_generation"


def test_thread_ids_differ_per_phase_so_graphs_never_collide() -> None:
    ids = {thread_id_for(_RUN_ID, p) for p in LoopPhase}
    assert len(ids) == len(LoopPhase)


def test_thread_id_rejects_empty_or_malformed_run_id() -> None:
    with pytest.raises(ValueError):
        thread_id_for("", LoopPhase.RELEASE_INTELLIGENCE)
    with pytest.raises(ValueError):
        thread_id_for("../etc/passwd", LoopPhase.RELEASE_INTELLIGENCE)
