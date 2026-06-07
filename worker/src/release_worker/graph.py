"""T5 (spec 001) / T2-T4 (spec 002) — LangGraph wiring for
``release_intelligence_graph``.

P1 (Substrate): orchestration is LangGraph only. This module owns the *graph* (its
nodes and edges); LangGraph owns state threading, retries, and (in later specs)
interrupts/checkpointing. It imports ``langgraph`` so it is loaded only by the runtime
entry point (``__main__``), never by the unit-test gate.

Spec 002 adds the first real work node, ``collect_evidence``, which runs the
load -> collect -> redact -> persist sub-chain (``collect_redact_persist``) so the
constitution's redact-before-persist gate (§5) is exercised inside the graph. The node
logic itself is pure and unit-tested directly against the in-memory fakes (see
``worker/tests/test_evidence_nodes.py``); here we only place it on the graph.
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from release_worker.evidence_nodes import collect_redact_persist
from release_worker.evidence_ports import BoundaryReader, DiffSource, EvidenceSink
from release_worker.nodes import run_passthrough
from release_worker.repository import ReleaseRunRepository
from release_worker.state import ReleaseRunState


def build_release_intelligence_graph(
    repository: ReleaseRunRepository,
    boundary_reader: BoundaryReader,
    diff_source: DiffSource,
    evidence_sink: EvidenceSink,
):
    """Compile the graph: START -> collect_evidence -> passthrough -> END.

    The ports are captured in node closures so each node stays a pure function of its
    ``(inputs, port)`` while LangGraph only sees ``state -> state`` callables.
    ``collect_evidence`` persists redacted evidence for the run, then ``passthrough``
    advances the run's status to completed (spec 001).
    """

    def _collect_evidence(state: ReleaseRunState) -> ReleaseRunState:
        # Side-effecting (S3 + Aurora writes), but redacted-only by construction —
        # persist_evidence accepts solely RedactedEvidence. State is unchanged.
        collect_redact_persist(
            state.release_run_id, boundary_reader, diff_source, evidence_sink
        )
        return state

    def _passthrough(state: ReleaseRunState) -> ReleaseRunState:
        return run_passthrough(state, repository)

    graph: StateGraph = StateGraph(ReleaseRunState)
    graph.add_node("collect_evidence", _collect_evidence)
    graph.add_node("passthrough", _passthrough)
    graph.add_edge(START, "collect_evidence")
    graph.add_edge("collect_evidence", "passthrough")
    graph.add_edge("passthrough", END)
    return graph.compile()
