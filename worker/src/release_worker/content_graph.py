"""T4 (spec 005) / T2-T5 (spec 006) — LangGraph wiring for ``content_generation_graph``
(PRD §5.3).

P1 (Substrate): orchestration is LangGraph only. This module owns the *graph* (its nodes
and edges); LangGraph owns state threading, retries, checkpointing, and the Gate #2
human-approval interrupt. It imports ``langgraph`` so it is loaded only by the runtime entry
point (``__main__``), never by the unit-test gate — the node logic itself is pure and
unit-tested directly against in-memory fakes (``worker/tests/test_content_nodes.py`` and
``worker/tests/test_claim_nodes.py``).

Spec 006 extends the content slice past draft persistence to claim-level provenance + the
second mandatory human gate (PRD §5.3):

    load_approved_features → snapshot_active_skills → generate_artifacts_parallel
        → extract_claims → link_claims_to_evidence → run_deterministic_policy_checks
        → run_bedrock_guardrails → persist_reviewable_artifacts → approve_artifacts (interrupt)
            approved        → complete
            rejected/edited → persist_artifact_review → complete

constitution §5 (no self-approval) is enforced by the ``interrupt`` at
``approve_artifacts``: the graph HALTS there until a human resolves Gate #2. The checks run
*before* the gate; a blocking finding marks the artifact ``status='blocked'`` so the
dashboard approve path refuses it (a failure escalates rather than auto-passing).
"""

from __future__ import annotations

from uuid import uuid4

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from release_worker.claim_nodes import (
    apply_check_outcomes,
    build_gate2_payload,
    extract_claims,
    link_claims_to_evidence,
    persist_artifact_review,
    persist_claims,
    route_after_gate2,
    run_bedrock_guardrails,
    run_deterministic_policy_checks,
)
from release_worker.claim_ports import (
    ArtifactReviewSink,
    ClaimEvidenceMatcher,
    ClaimSink,
    GuardrailScanner,
)
from release_worker.content_nodes import (
    generate_artifacts_parallel,
    load_approved_features,
    persist_reviewable_artifacts,
    snapshot_active_skills,
)
from release_worker.content_policy import NamedEntityPolicy
from release_worker.content_ports import (
    ApprovedFeatureReader,
    ArtifactSink,
    SkillSnapshotSink,
    SkillSource,
)
from release_worker.content_state import ContentRunState
from release_worker.feature_models import GateDecision
from release_worker.model_client import ModelClient


def build_content_generation_graph(
    approved_reader: ApprovedFeatureReader,
    skill_source: SkillSource,
    snapshot_sink: SkillSnapshotSink,
    model_client: ModelClient,
    artifact_sink: ArtifactSink,
    evidence_matcher: ClaimEvidenceMatcher,
    guardrail_scanner: GuardrailScanner,
    claim_sink: ClaimSink,
    review_sink: ArtifactReviewSink,
    *,
    model_id: str,
    dashboard_base_url: str,
    named_entity_policy: NamedEntityPolicy | None = None,
    checkpointer: object | None = None,
):
    """Compile the content-generation graph through Gate #2.

    The ports are captured in node closures so each node stays a pure function of its
    ``(inputs, port)`` while LangGraph only sees ``state -> state`` callables. ``model_id``
    is recorded on every draft for the §18.3 audit trail. A checkpointer is required for the
    Gate #2 interrupt/resume to work; the caller injects a durable one in production (the
    default ``MemorySaver`` is process-local).
    """

    def _load_approved_features(state: ContentRunState) -> ContentRunState:
        # Fails closed if zero approved (constitution §5); the run produces no artifacts.
        features = load_approved_features(state.release_run_id, approved_reader)
        return state.model_copy(update={"approved_features": features})

    def _snapshot_active_skills(state: ContentRunState) -> ContentRunState:
        snapshots = snapshot_active_skills(
            state.repo,
            skill_source.list_skills(),
            snapshot_sink,
            lambda: uuid4().hex,
        )
        return state.model_copy(update={"skill_snapshots": snapshots})

    def _generate_artifacts_parallel(state: ContentRunState) -> ContentRunState:
        # T1 (spec 007): fans out the full initial artifact set (PRD §8.1) concurrently,
        # each on its per-type skill selection (T2). uuid4 is thread-safe, so the parallel
        # id minting inside the node is race-free in production.
        artifacts, events = generate_artifacts_parallel(
            state.release_run_id,
            state.approved_features,
            state.skill_snapshots,
            model_client,
            lambda: uuid4().hex,
            model_id,
        )
        return state.model_copy(update={"artifacts": artifacts, "usage_events": events})

    def _extract_claims(state: ContentRunState) -> ContentRunState:
        claims = extract_claims(state.artifacts, model_client, lambda: uuid4().hex)
        return state.model_copy(update={"claims": claims})

    def _link_claims_to_evidence(state: ContentRunState) -> ContentRunState:
        claims, links = link_claims_to_evidence(state.claims, evidence_matcher)
        return state.model_copy(update={"claims": claims, "claim_links": links})

    def _run_deterministic_policy_checks(state: ContentRunState) -> ContentRunState:
        # T3 (spec 016) — the §18.2 layer-2 named checks (codenames/customer names/private URLs/
        # internal hostnames/security details) run here with the project-supplied policy.
        findings = run_deterministic_policy_checks(
            state.artifacts, state.claims, named_entity_policy
        )
        return state.model_copy(update={"check_findings": findings})

    def _run_bedrock_guardrails(state: ContentRunState) -> ContentRunState:
        # Guardrails is the last check before persist: accumulate its findings, then mark
        # every artifact a blocking finding (deterministic or Guardrail) hit as 'blocked'.
        findings = state.check_findings + run_bedrock_guardrails(
            state.artifacts, guardrail_scanner
        )
        artifacts = apply_check_outcomes(state.artifacts, findings)
        return state.model_copy(
            update={"check_findings": findings, "artifacts": artifacts}
        )

    def _persist_reviewable_artifacts(state: ContentRunState) -> ContentRunState:
        # Side-effecting Aurora writes in FK order: artifacts (with their checked status) +
        # usage events first, then claims, then claim_evidence_links. A blocked artifact
        # persists status='blocked'; an unsupported claim persists with no link (§5).
        persist_reviewable_artifacts(state.artifacts, state.usage_events, artifact_sink)
        persist_claims(state.claims, state.claim_links, claim_sink)
        return state

    def _approve_artifacts(state: ContentRunState) -> ContentRunState:
        payload = build_gate2_payload(
            state.release_run_id,
            state.thread_id,
            state.artifacts,
            dashboard_base_url,
        )
        # HALT: the graph blocks here until a human resumes with a decision string. No
        # artifact publishes while pending, and a blocked artifact can never be approved (§5).
        decision_raw = interrupt(payload.model_dump())
        return state.model_copy(update={"gate_decision": GateDecision(decision_raw)})

    def _persist_artifact_review(state: ContentRunState) -> ContentRunState:
        if state.gate_decision is None:  # pragma: no cover - guarded by routing
            raise ValueError("persist_artifact_review reached without a decision")
        persist_artifact_review(state.gate_decision, state.artifacts, review_sink)
        return state

    def _complete(state: ContentRunState) -> ContentRunState:
        # Terminal no-op: reached only after Gate #2 resolves, so a run halted at the
        # interrupt never auto-completes (constitution §5).
        return state

    def _route(state: ContentRunState) -> str:
        assert state.gate_decision is not None  # set by the gate node before routing
        return route_after_gate2(state.gate_decision)

    graph: StateGraph = StateGraph(ContentRunState)
    graph.add_node("load_approved_features", _load_approved_features)
    graph.add_node("snapshot_active_skills", _snapshot_active_skills)
    graph.add_node("generate_artifacts_parallel", _generate_artifacts_parallel)
    graph.add_node("extract_claims", _extract_claims)
    graph.add_node("link_claims_to_evidence", _link_claims_to_evidence)
    graph.add_node("run_deterministic_policy_checks", _run_deterministic_policy_checks)
    graph.add_node("run_bedrock_guardrails", _run_bedrock_guardrails)
    graph.add_node("persist_reviewable_artifacts", _persist_reviewable_artifacts)
    graph.add_node("approve_artifacts", _approve_artifacts)
    graph.add_node("persist_artifact_review", _persist_artifact_review)
    graph.add_node("complete", _complete)

    graph.add_edge(START, "load_approved_features")
    graph.add_edge("load_approved_features", "snapshot_active_skills")
    graph.add_edge("snapshot_active_skills", "generate_artifacts_parallel")
    graph.add_edge("generate_artifacts_parallel", "extract_claims")
    graph.add_edge("extract_claims", "link_claims_to_evidence")
    graph.add_edge("link_claims_to_evidence", "run_deterministic_policy_checks")
    graph.add_edge("run_deterministic_policy_checks", "run_bedrock_guardrails")
    graph.add_edge("run_bedrock_guardrails", "persist_reviewable_artifacts")
    graph.add_edge("persist_reviewable_artifacts", "approve_artifacts")
    graph.add_conditional_edges(
        "approve_artifacts",
        _route,
        {"approved": "complete", "persist_artifact_review": "persist_artifact_review"},
    )
    graph.add_edge("persist_artifact_review", "complete")
    graph.add_edge("complete", END)

    return graph.compile(checkpointer=checkpointer or MemorySaver())
