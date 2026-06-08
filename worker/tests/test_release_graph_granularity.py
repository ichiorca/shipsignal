"""T4 (spec 017) — the §5.2 manifest stage is registered as discrete graph nodes.

Two proofs. The gate-executable one: ``ReleaseRunState`` threads the intermediate
evidence/candidate/scored data the split nodes hand to each other — the contract that makes
``cluster_features`` → ``score_features`` → ``persist_feature_manifest`` separable while
keeping only redacted/structured data in checkpointed state (constitution §5). The second
compiles the real graph and asserts the discrete node set; it skips when langgraph isn't
installed (the unit gate) and runs on the Actions runner where it is.
"""

from __future__ import annotations

import pytest

from release_worker.feature_models import (
    CandidateFeature,
    FeatureScores,
    ScoredFeature,
)
from release_worker.state import ReleaseRunState

_RUN_ID = "11111111-1111-4111-8111-111111111111"
_THREAD = "lg_11111111-1111-4111-8111-111111111111_release_intelligence"


def test_state_threads_intermediate_manifest_stages() -> None:
    candidate = CandidateFeature(title="Onboarding checklist", evidence_ids=("ev-1",))
    scored = ScoredFeature(
        candidate=candidate,
        scores=FeatureScores(
            marketability_score=0.5,
            demoability_score=0.5,
            confidence=0.8,
            launch_risk="low",
        ),
    )
    # The split nodes carry candidates then scored between them; both must survive a
    # frozen model_copy update (LangGraph threads state by returning updated copies).
    state = ReleaseRunState(release_run_id=_RUN_ID, thread_id=_THREAD)
    after_cluster = state.model_copy(update={"candidates": (candidate,)})
    after_score = after_cluster.model_copy(update={"scored": (scored,)})

    assert after_cluster.candidates == (candidate,)
    assert after_score.candidates == (candidate,)  # earlier-stage data is preserved
    assert after_score.scored == (scored,)


def test_release_graph_registers_the_manifest_nodes_discretely() -> None:
    pytest.importorskip("langgraph")

    from release_worker.evidence_models import EvidenceRecord
    from release_worker.evidence_ports import (
        InMemoryBoundaryReader,
        InMemoryEvidenceSink,
        StaticDiffSource,
        StaticPullRequestSource,
    )
    from release_worker.feature_ports import InMemoryFeatureSink
    from release_worker.graph import build_release_intelligence_graph
    from release_worker.model_client import RecordingModelClient
    from release_worker.repository import InMemoryReleaseRunRepository

    class _Reader:
        def list_redacted_evidence(
            self, release_run_id: str
        ) -> tuple[EvidenceRecord, ...]:
            return ()

    compiled = build_release_intelligence_graph(
        InMemoryReleaseRunRepository(),
        InMemoryBoundaryReader(),
        StaticDiffSource({}),
        StaticPullRequestSource({}),
        InMemoryEvidenceSink(),
        _Reader(),
        RecordingModelClient({"features": []}),
        InMemoryFeatureSink(),
        dashboard_base_url="https://app.example.com",
    )

    nodes = set(compiled.get_graph().nodes)
    # The §5.2 manifest stage is three discrete nodes (per-node checkpoint/observability)…
    assert {"cluster_features", "score_features", "persist_feature_manifest"} <= nodes
    # …and the old fused node is gone.
    assert "cluster_score_persist" not in nodes
    # collect_evidence stays one node by accepted design (raw evidence must not enter state).
    assert "collect_evidence" in nodes
