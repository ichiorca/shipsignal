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

from release_worker.embedding_ports import EmbeddingClient
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
from release_worker.nodes import (
    begin_run,
    finalize_gate1,
    mark_evidence_ready,
    mark_features_pending_review,
)
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
    embedder: EmbeddingClient | None = None,
    checkpointer: object | None = None,
):
    """Compile the release-intelligence graph through Gate #1.

    The ports are captured in node closures so each node stays a pure function of its
    ``(inputs, port)`` while LangGraph only sees ``state -> state`` callables. A
    checkpointer is required for the interrupt/resume to work; the caller injects a
    durable one in production (the default ``MemorySaver`` is process-local) — see
    ``checkpointer.build_checkpointer`` (T1, spec 017).

    T2 (spec 017): ``embedder`` is passed to the collection node so each persisted evidence
    row carries a pgvector embedding (``None`` ⇒ lexical-only retrieval downstream).

    T4 (spec 017): the §5.2 feature-manifest stage is registered as three discrete nodes —
    ``cluster_features`` → ``score_features`` → ``persist_feature_manifest`` — so each gets
    its own checkpoint/observability boundary, matching the granularity of the other three
    graphs. ``collect_evidence`` stays one node by *explicitly accepted* design: its
    collect→redact→persist sub-chain must be atomic because raw, un-redacted excerpts may
    never enter LangGraph state/checkpoint (constitution §5 "redact before … before state");
    splitting it would force raw ``CollectedEvidence`` through state between nodes.
    """

    def _collect_evidence(state: ReleaseRunState) -> ReleaseRunState:
        # T1 (spec 015): persist the thread id + move created → collecting_evidence
        # before the work, then → evidence_ready once it is persisted, so the dashboard
        # reflects the run's real position (PRD §13.2). The collect itself is
        # side-effecting (S3 + Aurora writes), redacted-only by construction; state
        # carries only the status (raw evidence never enters it, constitution §5).
        advanced = begin_run(state, repository)
        collect_redact_persist_all(
            advanced.release_run_id,
            boundary_reader,
            diff_source,
            pr_source,
            evidence_sink,
            embedder,
        )
        return mark_evidence_ready(advanced, repository)

    def _cluster_features(state: ReleaseRunState) -> ReleaseRunState:
        # T4 (spec 017): load the redacted evidence once and cluster it. Evidence is carried
        # in state so the score + persist nodes reuse it without a second DB read.
        evidence = evidence_reader.list_redacted_evidence(state.release_run_id)
        candidates = cluster_features_with_bedrock(
            state.release_run_id, evidence, model_client
        )
        return state.model_copy(update={"evidence": evidence, "candidates": candidates})

    def _score_features(state: ReleaseRunState) -> ReleaseRunState:
        scored = score_features(state.candidates, state.evidence)
        return state.model_copy(update={"scored": scored})

    def _persist_feature_manifest(state: ReleaseRunState) -> ReleaseRunState:
        records = persist_feature_manifest(
            state.release_run_id,
            state.scored,
            state.evidence,
            feature_sink,
            lambda: uuid4().hex,
        )
        # T1 (spec 015): the manifest is persisted → the run is now awaiting Gate #1.
        pending = mark_features_pending_review(state, repository)
        return pending.model_copy(update={"features": records})

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
        # T1 (spec 015): finalize the run from the Gate #1 decision — approved →
        # features_approved (content generation takes over), rejected → cancelled, edited
        # → stays pending for re-review. Each hop is validated through the shared status
        # lattice. Reached only after the interrupt resolves, so a run halted at the gate
        # never auto-advances (constitution §5 — no self-approval).
        return finalize_gate1(state, repository)

    def _route(state: ReleaseRunState) -> str:
        assert state.gate_decision is not None  # set by the gate node before routing
        return route_after_gate1(state.gate_decision)

    graph: StateGraph = StateGraph(ReleaseRunState)
    graph.add_node("collect_evidence", _collect_evidence)
    graph.add_node("cluster_features", _cluster_features)
    graph.add_node("score_features", _score_features)
    graph.add_node("persist_feature_manifest", _persist_feature_manifest)
    graph.add_node("approve_feature_manifest", _approve_feature_manifest)
    graph.add_node("persist_review_decision", _persist_review_decision)
    graph.add_node("complete", _complete)

    graph.add_edge(START, "collect_evidence")
    graph.add_edge("collect_evidence", "cluster_features")
    graph.add_edge("cluster_features", "score_features")
    graph.add_edge("score_features", "persist_feature_manifest")
    graph.add_edge("persist_feature_manifest", "approve_feature_manifest")
    graph.add_conditional_edges(
        "approve_feature_manifest",
        _route,
        {"approved": "complete", "persist_review_decision": "persist_review_decision"},
    )
    graph.add_edge("persist_review_decision", "complete")
    graph.add_edge("complete", END)

    return graph.compile(checkpointer=checkpointer or MemorySaver())
