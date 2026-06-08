"""T2/T3/T4/T6 (spec 004) — the feature-manifest node chain through Gate #1.

Exercises the exact public surface the graph nodes wrap — clustering, scoring,
persistence, the gate payload + routing, and the review-decision node — against the
in-memory fakes (anti-pattern #4: no private helper, no DB/Bedrock/network). The fakes
record what was persisted / what prompt was sent, so the constitution's invariants are
*proven* by inspection, not merely asserted by reading the code:

* prompts contain only redacted evidence (AC) — inspect ``model_client.calls``;
* each persisted feature links to >=1 evidence item (AC) — inspect ``sink.links``;
* no self-approval (§5) — persisted status is always ``pending_review`` and only the
  review-decision node changes it.
"""

from __future__ import annotations

import itertools

import pytest

from release_worker.evidence_models import EvidenceRecord
from release_worker.feature_models import (
    CandidateFeature,
    FeatureRecord,
    GateDecision,
    MalformedModelOutputError,
)
from release_worker.feature_nodes import (
    build_gate1_payload,
    cluster_features_with_bedrock,
    persist_feature_manifest,
    persist_review_decision,
    route_after_gate1,
    score_features,
)
from release_worker.feature_ports import InMemoryFeatureSink
from release_worker.model_client import RecordingModelClient

_RUN_ID = "11111111-1111-4111-8111-111111111111"
_EV1 = "aaaaaaaa-1111-2222-3333-444444444444"
_EV2 = "bbbbbbbb-1111-2222-3333-444444444444"


def _evidence() -> tuple[EvidenceRecord, ...]:
    return (
        EvidenceRecord(
            evidence_id=_EV1,
            release_run_id=_RUN_ID,
            evidence_type="ui_string_change",
            source="git_diff",
            repo="org/product",
            file_path="src/onboarding/Checklist.tsx",
            raw_excerpt_s3_uri="s3://b/evidence/r/ev1.txt",
            redacted_excerpt="Add button: Create onboarding checklist",
            confidence=0.8,
        ),
        EvidenceRecord(
            evidence_id=_EV2,
            release_run_id=_RUN_ID,
            evidence_type="issue",
            source="issue_tracker",
            repo="org/product",
            raw_excerpt_s3_uri="s3://b/evidence/r/ev2.txt",
            redacted_excerpt="As an admin I want reusable onboarding checklists",
            confidence=0.6,
        ),
    )


def _cluster_response() -> dict[str, object]:
    return {
        "features": [
            {
                "title": "Admin-configurable onboarding checklist",
                "summary_internal": "Admins create and assign onboarding checklists.",
                "user_value": "Repeatable onboarding rollout.",
                "audiences": ["admin", "customer_success"],
                "change_type": "new_feature",
                "surface_area": ["web_app", "admin_console"],
                "evidence_ids": [_EV1, _EV2],
                "demo_steps_draft": ["Open settings", "Create checklist"],
            }
        ]
    }


# --- T2 clustering ----------------------------------------------------------------


def test_clustering_prompt_contains_only_redacted_evidence() -> None:
    """AC: prompts contain only redacted evidence (no raw field exists to leak)."""
    client = RecordingModelClient(_cluster_response())

    cluster_features_with_bedrock(_RUN_ID, _evidence(), client)

    prompt = client.calls[-1].messages[0]["content"]
    assert "Add button: Create onboarding checklist" in prompt
    assert _EV1 in prompt  # evidence id is cited so the model can reference it
    # The EvidenceRecord type has no raw_excerpt attribute at all (constitution §5).
    assert not any(hasattr(e, "raw_excerpt") for e in _evidence())


def test_clustering_validates_and_filters_unknown_evidence_ids() -> None:
    """Untrusted model output: a hallucinated evidence id is dropped (AC: >=1 real link)."""
    response = _cluster_response()
    response["features"][0]["evidence_ids"] = [_EV1, "deadbeef-hallucinated"]
    client = RecordingModelClient(response)

    features = cluster_features_with_bedrock(_RUN_ID, _evidence(), client)

    assert len(features) == 1
    assert features[0].evidence_ids == (_EV1,)  # the fake id was filtered out


def test_clustering_drops_features_with_no_real_evidence() -> None:
    response = {"features": [{"title": "Ghost", "evidence_ids": ["nope"]}]}
    client = RecordingModelClient(response)

    assert cluster_features_with_bedrock(_RUN_ID, _evidence(), client) == ()


def test_clustering_empty_evidence_skips_the_model_call() -> None:
    client = RecordingModelClient(_cluster_response())

    assert cluster_features_with_bedrock(_RUN_ID, (), client) == ()
    assert client.calls == []  # no evidence → no Bedrock call (cost discipline)


def test_clustering_idempotency_key_is_stable_for_same_evidence() -> None:
    """aws-bedrock-rules: a retried call reuses the same dedupe key."""
    client = RecordingModelClient(_cluster_response())

    cluster_features_with_bedrock(_RUN_ID, _evidence(), client)
    cluster_features_with_bedrock(_RUN_ID, tuple(reversed(_evidence())), client)

    assert client.calls[0].idempotency_key == client.calls[1].idempotency_key


def test_clustering_rejects_malformed_model_output() -> None:
    client = RecordingModelClient({"features": [{"summary_internal": "no title"}]})

    with pytest.raises(MalformedModelOutputError) as exc:
        cluster_features_with_bedrock(_RUN_ID, _evidence(), client)
    assert "malformed" in str(exc.value)


# --- T3 scoring + persist ---------------------------------------------------------


def test_scoring_is_deterministic_and_in_range() -> None:
    client = RecordingModelClient(_cluster_response())
    candidates = cluster_features_with_bedrock(_RUN_ID, _evidence(), client)

    a = score_features(candidates, _evidence())
    b = score_features(candidates, _evidence())

    assert a == b  # reproducible (no model call, no randomness)
    s = a[0].scores
    for value in (s.marketability_score, s.demoability_score, s.confidence):
        assert 0.0 <= value <= 1.0
    # confidence = mean(0.8, 0.6) = 0.7 → medium launch risk
    assert s.confidence == pytest.approx(0.7)
    assert s.launch_risk == "medium"


def test_persist_writes_pending_features_with_evidence_links() -> None:
    """AC: each persisted feature links to >=1 evidence item; status is pending_review."""
    client = RecordingModelClient(_cluster_response())
    candidates = cluster_features_with_bedrock(_RUN_ID, _evidence(), client)
    scored = score_features(candidates, _evidence())
    sink = InMemoryFeatureSink()
    ids = (f"feat-{n}" for n in itertools.count())

    records = persist_feature_manifest(
        _RUN_ID, scored, _evidence(), sink, lambda: next(ids)
    )

    assert len(records) == 1
    assert records[0].status == "pending_review"  # no self-approval (§5)
    # Two evidence links, each with the source evidence's confidence as relevance.
    linked = {(e, round(r, 3)) for f, e, r in sink.links if f == "feat-0"}
    assert linked == {(_EV1, 0.8), (_EV2, 0.6)}
    assert len(sink.links) >= 1


def test_persist_skips_feature_when_no_evidence_resolves() -> None:
    """Defensive: a scored feature whose ids aren't in the evidence set is not written."""
    sink = InMemoryFeatureSink()
    orphan = score_features(
        (CandidateFeature(title="Orphan", evidence_ids=("missing",)),), _evidence()
    )
    # scoring itself already drops it (no resolvable evidence) → nothing to persist.
    records = persist_feature_manifest(
        _RUN_ID, orphan, _evidence(), sink, lambda: "feat-x"
    )
    assert records == ()
    assert sink.features == []


# --- T4 gate payload + routing ----------------------------------------------------


def test_gate1_payload_matches_prd_contract() -> None:
    payload = build_gate1_payload(_RUN_ID, "lg_thread_1", 3, "https://app.example.com/")

    assert payload.gate == "feature_manifest_approval"
    assert payload.release_run_id == _RUN_ID
    assert payload.thread_id == "lg_thread_1"
    assert payload.features_pending_review == 3
    assert payload.dashboard_url == f"https://app.example.com/releases/{_RUN_ID}/review"


def test_routing_only_approved_ends_the_graph() -> None:
    assert route_after_gate1(GateDecision.APPROVED) == "approved"
    assert route_after_gate1(GateDecision.REJECTED) == "persist_review_decision"
    assert route_after_gate1(GateDecision.EDITED) == "persist_review_decision"


# --- T6 persist review decision ---------------------------------------------------


def _persisted_feature(status: str = "pending_review") -> FeatureRecord:
    return FeatureRecord(
        feature_id="feat-0",
        release_run_id=_RUN_ID,
        title="Admin onboarding checklist",
        marketability_score=0.5,
        demoability_score=0.5,
        confidence=0.7,
        launch_risk="medium",
        evidence_ids=(_EV1,),
    )


@pytest.mark.parametrize(
    "decision", [GateDecision.REJECTED, GateDecision.EDITED, GateDecision.APPROVED]
)
def test_review_decision_sets_status_so_only_approved_flows_downstream(
    decision: GateDecision,
) -> None:
    sink = InMemoryFeatureSink()
    feature = _persisted_feature()

    affected = persist_review_decision(decision, (feature,), sink, reviewer_notes="r")

    assert affected == ("feat-0",)
    assert sink.statuses["feat-0"] == (decision.value, "r")
    # rejected/edited features are not 'approved' → spec 005 won't load them downstream.
    if decision is not GateDecision.APPROVED:
        assert sink.statuses["feat-0"][0] != "approved"
