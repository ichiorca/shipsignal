"""T5 (spec 001) / T2-T4 (spec 002) / T2-T4,T6 (spec 004) — LangGraph wiring for
``release_intelligence_graph``.

P1 (Substrate): orchestration is LangGraph only. This module owns the *graph* (its
nodes and edges); LangGraph owns state threading, retries, checkpointing, and the
human-approval interrupt. It imports ``langgraph`` so it is loaded only by the runtime
entry point (``__main__``), never by the unit-test gate — the node logic itself is pure
and unit-tested directly against in-memory fakes (``worker/tests/test_feature_nodes.py``).

Spec 004 extends the chain past evidence to the feature manifest and the first mandatory
human gate (PRD §5.2):

    collect_evidence → cluster_score_persist → approve_feature_manifest (interrupt)
        approved        → complete
        rejected/edited → persist_review_decision → complete

constitution §5 (no self-approval) is enforced by the ``interrupt`` at
``approve_feature_manifest``: the graph HALTS there and cannot reach content generation
(a later graph) until a human resolves the gate. ``persist_feature_manifest`` writes
features as ``pending_review``; only ``persist_review_decision`` — driven by the resumed
human decision — changes their status.
"""

from __future__ import annotations

from uuid import uuid4

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from release_worker.evidence_nodes import collect_redact_persist_all
from release_worker.evidence_ports import (
    BoundaryReader,
    DiffSource,
    EvidenceSink,
    PullRequestSource,
)
from release_worker.feature_models import GateDecision
from release_worker.feature_nodes import (
    build_gate1_payload,
    cluster_features_with_bedrock,
    persist_feature_manifest,
    persist_review_decision,
    route_after_gate1,
    score_features,
)
from release_worker.feature_ports import FeatureSink, RedactedEvidenceReader
from release_worker.model_client import ModelClient
from release_worker.nodes import run_passthrough
from release_worker.repository import ReleaseRunRepository
from release_worker.state import ReleaseRunState


def build_release_intelligence_graph(
    repository: ReleaseRunRepository,
    boundary_reader: BoundaryReader,
    diff_source: DiffSource,
    pr_source: PullRequestSource,
    evidence_sink: EvidenceSink,
    evidence_reader: RedactedEvidenceReader,
    model_client: ModelClient,
    feature_sink: FeatureSink,
    *,
    dashboard_base_url: str,
    checkpointer: object | None = None,
):
    """Compile the release-intelligence graph through Gate #1.

    The ports are captured in node closures so each node stays a pure function of its
    ``(inputs, port)`` while LangGraph only sees ``state -> state`` callables. A
    checkpointer is required for the interrupt/resume to work; the caller injects a
    durable one in production (the default ``MemorySaver`` is process-local).
    """

    def _collect_evidence(state: ReleaseRunState) -> ReleaseRunState:
        # Side-effecting (S3 + Aurora writes), redacted-only by construction. State
        # unchanged — raw evidence never enters it (constitution §5).
        collect_redact_persist_all(
            state.release_run_id,
            boundary_reader,
            diff_source,
            pr_source,
            evidence_sink,
        )
        return state

    def _cluster_score_persist(state: ReleaseRunState) -> ReleaseRunState:
        evidence = evidence_reader.list_redacted_evidence(state.release_run_id)
        candidates = cluster_features_with_bedrock(
            state.release_run_id, evidence, model_client
        )
        scored = score_features(candidates, evidence)
        records = persist_feature_manifest(
            state.release_run_id,
            scored,
            evidence,
            feature_sink,
            lambda: uuid4().hex,
        )
        return state.model_copy(update={"features": records})

    def _approve_feature_manifest(state: ReleaseRunState) -> ReleaseRunState:
        payload = build_gate1_payload(
            state.release_run_id,
            state.thread_id,
            len(state.features),
            dashboard_base_url,
        )
        # HALT: the graph blocks here until a human resumes with a decision string.
        # Nothing downstream (content generation) can run while pending (AC / §5).
        decision_raw = interrupt(payload.model_dump())
        return state.model_copy(update={"gate_decision": GateDecision(decision_raw)})

    def _persist_review_decision(state: ReleaseRunState) -> ReleaseRunState:
        if state.gate_decision is None:  # pragma: no cover - guarded by routing
            raise ValueError("persist_review_decision reached without a decision")
        persist_review_decision(state.gate_decision, state.features, feature_sink)
        return state

    def _complete(state: ReleaseRunState) -> ReleaseRunState:
        # Reuse the spec-001 completion node: it advances the run queued -> running ->
        # completed (writing langgraph_thread_id), validating each hop through the shared
        # status lattice. Reached only after Gate #1 resolves, so a run halted at the
        # interrupt never auto-completes (constitution §5).
        return run_passthrough(state, repository)

    def _route(state: ReleaseRunState) -> str:
        assert state.gate_decision is not None  # set by the gate node before routing
        return route_after_gate1(state.gate_decision)

    graph: StateGraph = StateGraph(ReleaseRunState)
    graph.add_node("collect_evidence", _collect_evidence)
    graph.add_node("cluster_score_persist", _cluster_score_persist)
    graph.add_node("approve_feature_manifest", _approve_feature_manifest)
    graph.add_node("persist_review_decision", _persist_review_decision)
    graph.add_node("complete", _complete)

    graph.add_edge(START, "collect_evidence")
    graph.add_edge("collect_evidence", "cluster_score_persist")
    graph.add_edge("cluster_score_persist", "approve_feature_manifest")
    graph.add_conditional_edges(
        "approve_feature_manifest",
        _route,
        {"approved": "complete", "persist_review_decision": "persist_review_decision"},
    )
    graph.add_edge("persist_review_decision", "complete")
    graph.add_edge("complete", END)

    return graph.compile(checkpointer=checkpointer or MemorySaver())
