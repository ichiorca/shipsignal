"""T2-T6 (spec 009) — LangGraph wiring for ``skill_learning_graph`` (PRD §5.5).

P1 (Substrate): orchestration is LangGraph only. This module owns the *graph* (its nodes and
edges); LangGraph owns state threading, retries, checkpointing, and the Gate #3 human-approval
interrupt. It imports ``langgraph`` so it is loaded only by the runtime entry point
(``__main__``), never by the unit-test gate — the node logic itself is pure and unit-tested
directly against in-memory fakes (``worker/tests/test_skill_learning_nodes.py``).

    collect_learning_signals → cluster_edit_patterns → cluster_rejection_patterns
        → select_impacted_skills → draft_skill_revision_candidate → persist_candidate_in_aurora
        → approve_skill_candidate (interrupt)
            approved → update_repo_skill_file → mark_candidate_promoted → END
            rejected → record_rejection_and_suppression → END

constitution §5 (no self-approval / no silent overwrite) is enforced by the ``interrupt`` at
``approve_skill_candidate``: the graph HALTS there until a human resolves Gate #3. The single
repo write (``update_repo_skill_file``) sits on the approved branch ONLY — a rejected/pending
candidate never reaches it, so no ``SKILL.md`` is overwritten without an approved decision (AC1).
"""

from __future__ import annotations

from uuid import uuid4

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from release_worker.claim_ports import GuardrailScanner
from release_worker.content_policy import NamedEntityPolicy
from release_worker.model_client import ModelClient
from release_worker.skill_learning_nodes import (
    build_gate3_payload,
    cluster_edit_patterns,
    cluster_rejection_patterns,
    collect_learning_signals,
    draft_skill_revision_candidate,
    mark_candidate_promoted,
    parse_skill_gate,
    persist_candidate_in_aurora,
    prevent_unsafe_promotion,
    record_rejection_and_suppression,
    route_after_gate3,
    select_impacted_skills,
    update_repo_skill_file,
)
from release_worker.skill_learning_ports import (
    ActiveSkillReader,
    LearningSignalSink,
    LearningSignalSource,
    RepoSkillWriter,
    SkillCandidateSink,
    SuppressionStore,
)
from release_worker.skill_learning_state import SkillLearningState


def build_skill_learning_graph(
    signal_source: LearningSignalSource,
    signal_sink: LearningSignalSink,
    active_skill_reader: ActiveSkillReader,
    model_client: ModelClient,
    suppressions: SuppressionStore,
    candidate_sink: SkillCandidateSink,
    repo_writer: RepoSkillWriter,
    guardrail_scanner: GuardrailScanner,
    *,
    dashboard_base_url: str,
    named_entity_policy: NamedEntityPolicy | None = None,
    checkpointer: object | None = None,
):
    """Compile the skill-learning graph through Gate #3 (PRD §5.5).

    The ports are captured in node closures so each node stays a pure function of its
    ``(inputs, port)`` while LangGraph only sees ``state -> state`` callables. A checkpointer is
    required for the Gate #3 interrupt/resume to work; the caller injects a durable one in
    production (the default ``MemorySaver`` is process-local). ``new_*_id`` are minted with
    ``uuid4`` (thread-safe) so node logic stays pure of id generation.
    """

    def _collect_learning_signals(state: SkillLearningState) -> SkillLearningState:
        signals = collect_learning_signals(
            state.release_run_id, signal_source, signal_sink, lambda: uuid4().hex
        )
        return state.model_copy(update={"signals": signals})

    def _cluster_edit_patterns(state: SkillLearningState) -> SkillLearningState:
        return state.model_copy(
            update={"edit_clusters": cluster_edit_patterns(state.signals)}
        )

    def _cluster_rejection_patterns(state: SkillLearningState) -> SkillLearningState:
        return state.model_copy(
            update={"rejection_clusters": cluster_rejection_patterns(state.signals)}
        )

    def _select_impacted_skills(state: SkillLearningState) -> SkillLearningState:
        impacted = select_impacted_skills(
            state.edit_clusters + state.rejection_clusters, active_skill_reader
        )
        return state.model_copy(update={"impacted_skills": impacted})

    def _draft_skill_revision_candidate(
        state: SkillLearningState,
    ) -> SkillLearningState:
        candidates = draft_skill_revision_candidate(
            state.impacted_skills, model_client, suppressions, lambda: uuid4().hex
        )
        return state.model_copy(update={"candidates": candidates})

    def _persist_candidate_in_aurora(state: SkillLearningState) -> SkillLearningState:
        # Stages each candidate as status='draft'; never touches the repo file (§9.2).
        persist_candidate_in_aurora(state.candidates, candidate_sink)
        return state

    def _approve_skill_candidate(state: SkillLearningState) -> SkillLearningState:
        payload = build_gate3_payload(
            state.release_run_id,
            state.thread_id,
            state.candidates,
            dashboard_base_url,
        )
        # HALT: the graph blocks here until a human resumes with a decision. No SKILL.md is
        # overwritten while a candidate is pending (constitution §5 / AC1).
        decision_raw = interrupt(payload.model_dump())
        return state.model_copy(
            update={"gate_resolution": parse_skill_gate(decision_raw)}
        )

    def _scan_skill_candidate(state: SkillLearningState) -> SkillLearningState:
        # T4 (spec 016) — §18.2 layer-3 pre-promotion content scan. Reached on the approved branch
        # BEFORE the repo write: a deterministic secret/named-entity hit or a Guardrails
        # intervention on the rendered candidate raises SkillCandidatePromotionBlockedError, so the
        # run fails closed and NO SKILL.md is overwritten (constitution §5 / AC3).
        prevent_unsafe_promotion(
            state.candidates, guardrail_scanner, named_entity_policy
        )
        return state

    def _update_repo_skill_file(state: SkillLearningState) -> SkillLearningState:
        # Reached only on the approved branch, AFTER the layer-3 scan passed — the single repo
        # write (§5 blast radius).
        assert state.gate_resolution is not None  # set by the gate node before routing
        records = update_repo_skill_file(
            state.candidates, state.gate_resolution, repo_writer
        )
        return state.model_copy(update={"promotion_records": records})

    def _mark_candidate_promoted(state: SkillLearningState) -> SkillLearningState:
        mark_candidate_promoted(state.promotion_records, candidate_sink)
        return state

    def _record_rejection_and_suppression(
        state: SkillLearningState,
    ) -> SkillLearningState:
        assert state.gate_resolution is not None  # set by the gate node before routing
        record_rejection_and_suppression(
            state.candidates, state.gate_resolution, candidate_sink, suppressions
        )
        return state

    def _route(state: SkillLearningState) -> str:
        assert state.gate_resolution is not None  # set by the gate node before routing
        return route_after_gate3(state.gate_resolution)

    graph: StateGraph = StateGraph(SkillLearningState)
    graph.add_node("collect_learning_signals", _collect_learning_signals)
    graph.add_node("cluster_edit_patterns", _cluster_edit_patterns)
    graph.add_node("cluster_rejection_patterns", _cluster_rejection_patterns)
    graph.add_node("select_impacted_skills", _select_impacted_skills)
    graph.add_node("draft_skill_revision_candidate", _draft_skill_revision_candidate)
    graph.add_node("persist_candidate_in_aurora", _persist_candidate_in_aurora)
    graph.add_node("approve_skill_candidate", _approve_skill_candidate)
    graph.add_node("scan_skill_candidate", _scan_skill_candidate)
    graph.add_node("update_repo_skill_file", _update_repo_skill_file)
    graph.add_node("mark_candidate_promoted", _mark_candidate_promoted)
    graph.add_node(
        "record_rejection_and_suppression", _record_rejection_and_suppression
    )

    graph.add_edge(START, "collect_learning_signals")
    graph.add_edge("collect_learning_signals", "cluster_edit_patterns")
    graph.add_edge("cluster_edit_patterns", "cluster_rejection_patterns")
    graph.add_edge("cluster_rejection_patterns", "select_impacted_skills")
    graph.add_edge("select_impacted_skills", "draft_skill_revision_candidate")
    graph.add_edge("draft_skill_revision_candidate", "persist_candidate_in_aurora")
    graph.add_edge("persist_candidate_in_aurora", "approve_skill_candidate")
    # Approved → layer-3 scan → (if it passes) the single repo write. The scan node fails the run
    # closed if any candidate trips a check, so promotion is blocked before any SKILL.md is written.
    graph.add_conditional_edges(
        "approve_skill_candidate",
        _route,
        {
            "update_repo_skill_file": "scan_skill_candidate",
            "record_rejection_and_suppression": "record_rejection_and_suppression",
        },
    )
    graph.add_edge("scan_skill_candidate", "update_repo_skill_file")
    graph.add_edge("update_repo_skill_file", "mark_candidate_promoted")
    graph.add_edge("mark_candidate_promoted", END)
    graph.add_edge("record_rejection_and_suppression", END)

    return graph.compile(checkpointer=checkpointer or MemorySaver())
