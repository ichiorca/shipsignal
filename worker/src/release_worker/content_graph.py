"""T4 (spec 005) — LangGraph wiring for ``content_generation_graph`` (PRD §5.3).

P1 (Substrate): orchestration is LangGraph only. This module owns the *graph* (its nodes
and edges); LangGraph owns state threading and retries. It imports ``langgraph`` so it is
loaded only by the runtime entry point (``__main__``), never by the unit-test gate — the
node logic itself is pure and unit-tested directly against in-memory fakes
(``worker/tests/test_content_nodes.py``).

This is the FIRST content slice (PRD §5.3, through draft persistence only):

    load_approved_features → snapshot_active_skills → generate_artifacts
        → persist_reviewable_artifacts → END

There is deliberately NO Gate #2 / claims / checks here — that is the next slice (spec
006). ``load_approved_features`` fails closed when the run has zero approved features
(constitution §5: never generate from unapproved work), so a run that should not generate
produces no artifacts. Artifacts persist ``status='draft'``; only Gate #2 (later) advances
them — no node here self-approves.
"""

from __future__ import annotations

from uuid import uuid4

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from release_worker.content_nodes import (
    generate_artifacts,
    load_approved_features,
    persist_reviewable_artifacts,
    snapshot_active_skills,
)
from release_worker.content_ports import (
    ApprovedFeatureReader,
    ArtifactSink,
    SkillSnapshotSink,
    SkillSource,
)
from release_worker.content_state import ContentRunState
from release_worker.model_client import ModelClient


def build_content_generation_graph(
    approved_reader: ApprovedFeatureReader,
    skill_source: SkillSource,
    snapshot_sink: SkillSnapshotSink,
    model_client: ModelClient,
    artifact_sink: ArtifactSink,
    *,
    model_id: str,
    checkpointer: object | None = None,
):
    """Compile the content-generation graph through draft persistence.

    The ports are captured in node closures so each node stays a pure function of its
    ``(inputs, port)`` while LangGraph only sees ``state -> state`` callables. ``model_id``
    is recorded on every draft for the §18.3 audit trail.
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

    def _generate_artifacts(state: ContentRunState) -> ContentRunState:
        artifacts, events = generate_artifacts(
            state.release_run_id,
            state.approved_features,
            state.skill_snapshots,
            model_client,
            lambda: uuid4().hex,
            model_id,
        )
        return state.model_copy(update={"artifacts": artifacts, "usage_events": events})

    def _persist_reviewable_artifacts(state: ContentRunState) -> ContentRunState:
        # Side-effecting Aurora writes (artifacts first: the usage events FK-reference the
        # artifact row). State unchanged — the drafts already live on it. Every row is
        # status='draft' (no self-approval, §5).
        persist_reviewable_artifacts(state.artifacts, state.usage_events, artifact_sink)
        return state

    graph: StateGraph = StateGraph(ContentRunState)
    graph.add_node("load_approved_features", _load_approved_features)
    graph.add_node("snapshot_active_skills", _snapshot_active_skills)
    graph.add_node("generate_artifacts", _generate_artifacts)
    graph.add_node("persist_reviewable_artifacts", _persist_reviewable_artifacts)

    graph.add_edge(START, "load_approved_features")
    graph.add_edge("load_approved_features", "snapshot_active_skills")
    graph.add_edge("snapshot_active_skills", "generate_artifacts")
    graph.add_edge("generate_artifacts", "persist_reviewable_artifacts")
    graph.add_edge("persist_reviewable_artifacts", END)

    return graph.compile(checkpointer=checkpointer or MemorySaver())
