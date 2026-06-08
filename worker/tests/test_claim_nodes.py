"""T2/T3/T4/T5 (spec 006) — the claim/check/Gate-2 node chain of content_generation_graph.

Exercises the exact public surface the graph nodes wrap — claim extraction, evidence
linking, the deterministic + Guardrail checks, claim persistence, and the Gate #2
interrupt/review — against the in-memory fakes (anti-pattern #4: no private helper, no
DB/Bedrock/network). The fakes record what was persisted / scanned, so the constitution's
invariants are *proven* by inspection:

* §5 — model output is untrusted: a malformed claim payload is rejected; claim_type/risk are
  normalized to known enums.
* §5 — claim-level provenance: a grounded capability claim links to >=1 evidence item and
  becomes SUPPORTED; a fabricated ROI figure links to nothing and stays UNSUPPORTED.
* §5/§7 — checks are blocking: an unsupported metric, an unsupported high-risk claim, a
  leaked secret, and a Guardrail intervention each mark the artifact 'blocked' (Gate #2
  cannot approve a blocked artifact).
* §5 — no self-approval: persist_artifact_review only applies rejected/edited; the route
  keeps 'approved' out of the graph.
"""

from __future__ import annotations

import itertools

import pytest

from release_worker.claim_models import (
    ClaimEvidenceCandidate,
    FindingSeverity,
    Gate2Payload,
    GuardrailVerdict,
    MalformedClaimOutputError,
    RiskLevel,
    SupportStatus,
)
from release_worker.claim_nodes import (
    BLOCKED_STATUS,
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
    InMemoryArtifactReviewSink,
    InMemoryClaimEvidenceMatcher,
    InMemoryClaimSink,
    InMemoryGuardrailScanner,
)
from release_worker.content_models import ArtifactDraft
from release_worker.feature_models import GateDecision
from release_worker.model_client import RecordingModelClient

_RUN_ID = "11111111-1111-4111-8111-111111111111"
_ART_ID = "aaaaaaaa-1111-2222-3333-444444444444"


def _artifact(
    body: str = "# Release\n\nAdmins can create onboarding checklists.",
) -> ArtifactDraft:
    return ArtifactDraft(
        artifact_id=_ART_ID,
        release_run_id=_RUN_ID,
        feature_id=None,
        artifact_type="release_blog",
        title="Release highlights",
        body_markdown=body,
        status="draft",
        model_id="bedrock-model-x",
        prompt_version="content-gen-v1",
        skill_versions={},
    )


# A capability claim grounded in the evidence + a fabricated ROI metric with no evidence.
_CLAIM_RESPONSE: dict[str, object] = {
    "claims": [
        {
            "claim_text": "Admins can now create reusable onboarding checklists.",
            "claim_type": "capability",
            "risk_level": "low",
        },
        {
            "claim_text": "This reduces onboarding time by 50%.",
            "claim_type": "performance",
            "risk_level": "high",
        },
    ]
}

_EVIDENCE = (
    ClaimEvidenceCandidate(
        evidence_id="ev-1",
        redacted_excerpt="Add button: Create onboarding checklist for new team members.",
    ),
)


def _claim_ids() -> itertools.count[int]:
    return itertools.count()


def _extract_one_artifact() -> tuple:
    client = RecordingModelClient(_CLAIM_RESPONSE)
    ids = (f"claim-{n}" for n in _claim_ids())
    claims = extract_claims((_artifact(),), client, lambda: next(ids))
    return claims, client


# The full initial artifact set (spec 007 §8.1) — the claim/check path must treat them all
# identically (T3), with no per-type branch.
_INITIAL_ARTIFACT_TYPES = (
    "release_blog",
    "changelog_entry",
    "sales_onepager",
    "linkedin_post",
    "demo_script",
    "release_audio_digest",
)


def _artifact_of(
    artifact_type: str,
    artifact_id: str,
    body: str = "# Release\n\nAdmins can create onboarding checklists.",
) -> ArtifactDraft:
    return ArtifactDraft(
        artifact_id=artifact_id,
        release_run_id=_RUN_ID,
        feature_id=None,
        artifact_type=artifact_type,
        title="Release highlights",
        body_markdown=body,
        status="draft",
        model_id="bedrock-model-x",
        prompt_version="content-gen-v1",
        skill_versions={},
    )


# --- T2 — extract_claims ----------------------------------------------------------


def test_extract_claims_produces_typed_claims_unsupported_by_default() -> None:
    claims, _client = _extract_one_artifact()
    assert len(claims) == 2
    # Every claim starts UNSUPPORTED — grounding is decided downstream, not by the model (§5).
    assert {c.support_status for c in claims} == {SupportStatus.UNSUPPORTED.value}
    by_text = {c.claim_text: c for c in claims}
    cap = by_text["Admins can now create reusable onboarding checklists."]
    assert cap.claim_type == "capability"
    assert cap.risk_level == RiskLevel.LOW.value
    assert all(c.artifact_id == _ART_ID for c in claims)


def test_extract_claims_normalizes_unknown_type_and_risk() -> None:
    client = RecordingModelClient(
        {
            "claims": [
                {"claim_text": "X works.", "claim_type": "bogus", "risk_level": "weird"}
            ]
        }
    )
    ids = (f"claim-{n}" for n in _claim_ids())
    claims = extract_claims((_artifact(),), client, lambda: next(ids))
    assert claims[0].claim_type == "general"  # unknown → GENERAL
    assert claims[0].risk_level == RiskLevel.MEDIUM.value  # unknown → MEDIUM


def test_extract_claims_rejects_malformed_output() -> None:
    client = RecordingModelClient(
        {"claims": [{"claim_type": "capability"}]}
    )  # no claim_text
    ids = (f"claim-{n}" for n in _claim_ids())
    with pytest.raises(MalformedClaimOutputError) as exc:
        extract_claims((_artifact(),), client, lambda: next(ids))
    assert "malformed" in str(exc.value)


def test_extract_idempotency_key_stable_for_same_artifact() -> None:
    _claims, client = _extract_one_artifact()
    first = client.calls[-1].idempotency_key
    _extract_one_artifact()  # a fresh client/run over the same artifact
    # A new client records its own call; recompute on the same artifact gives the same key.
    client2 = RecordingModelClient(_CLAIM_RESPONSE)
    ids = (f"c-{n}" for n in _claim_ids())
    extract_claims((_artifact(),), client2, lambda: next(ids))
    assert client2.calls[-1].idempotency_key == first


# --- T3 — link_claims_to_evidence -------------------------------------------------


def test_supported_claim_links_to_evidence() -> None:
    """AC: every approved claim has >=1 claim_evidence_links row (the capability claim)."""
    claims, _ = _extract_one_artifact()
    matcher = InMemoryClaimEvidenceMatcher(_EVIDENCE)
    resolved, links = link_claims_to_evidence(claims, matcher)

    cap = next(c for c in resolved if "create reusable" in c.claim_text)
    assert cap.support_status == SupportStatus.SUPPORTED.value
    assert cap.evidence_ids == ("ev-1",)
    assert any(link.claim_id == cap.claim_id for link in links)
    assert all(0.0 <= link.support_score <= 1.0 for link in links)


def test_fabricated_metric_claim_stays_unsupported_with_no_link() -> None:
    """AC: a fabricated ROI figure with no evidence cannot be grounded (no link row)."""
    claims, _ = _extract_one_artifact()
    matcher = InMemoryClaimEvidenceMatcher(_EVIDENCE)
    resolved, links = link_claims_to_evidence(claims, matcher)

    roi = next(c for c in resolved if "50%" in c.claim_text)
    assert roi.support_status == SupportStatus.UNSUPPORTED.value
    assert roi.evidence_ids == ()
    assert all(link.claim_id != roi.claim_id for link in links)


def test_metric_claim_links_only_when_figure_present_in_evidence() -> None:
    """The metric-subset guard: the same claim grounds iff its figure appears in evidence."""
    claims, _ = _extract_one_artifact()
    with_figure = (
        ClaimEvidenceCandidate(
            evidence_id="ev-2",
            redacted_excerpt="Onboarding time dropped 50% in the pilot for new team members.",
        ),
    )
    resolved, _links = link_claims_to_evidence(
        claims, InMemoryClaimEvidenceMatcher(with_figure)
    )
    roi = next(c for c in resolved if "50%" in c.claim_text)
    assert roi.support_status == SupportStatus.SUPPORTED.value


# --- T4 — deterministic checks + Guardrails ---------------------------------------


def _resolved_claims() -> tuple:
    claims, _ = _extract_one_artifact()
    resolved, _links = link_claims_to_evidence(
        claims, InMemoryClaimEvidenceMatcher(_EVIDENCE)
    )
    return resolved


def _codes(findings, severity: FindingSeverity) -> set[str]:
    return {f.code for f in findings if f.severity == severity.value}


def test_unsupported_metric_is_a_blocking_finding() -> None:
    """AC: an unsupported/high-risk claim is blocked and cannot reach an approved state."""
    findings = run_deterministic_policy_checks((_artifact(),), _resolved_claims())
    assert "unverified_metric" in _codes(findings, FindingSeverity.BLOCKING)


def test_secret_in_body_is_a_blocking_finding() -> None:
    body = "# Release\n\nReach the team at admin@internal.example for access."
    findings = run_deterministic_policy_checks((_artifact(body),), _resolved_claims())
    secret = next(f for f in findings if f.code == "secret_leak")
    assert secret.severity == FindingSeverity.BLOCKING.value
    # The detail names the rule that fired, never the matched value (constitution §5).
    assert "admin@internal.example" not in secret.detail


def test_supported_claim_alone_yields_no_blocking_finding() -> None:
    matcher = InMemoryClaimEvidenceMatcher(_EVIDENCE)
    claims, _ = _extract_one_artifact()
    # Keep only the grounded capability claim.
    resolved, _links = link_claims_to_evidence(claims, matcher)
    supported = tuple(
        c for c in resolved if c.support_status == SupportStatus.SUPPORTED.value
    )
    findings = run_deterministic_policy_checks((_artifact(),), supported)
    assert _codes(findings, FindingSeverity.BLOCKING) == set()


def test_guardrail_intervention_blocks_the_artifact() -> None:
    """AC: Guardrails run on every artifact and a failure halts rather than auto-passing."""
    scanner = InMemoryGuardrailScanner(
        GuardrailVerdict(
            blocked=True, action="GUARDRAIL_INTERVENED", categories=("contentPolicy",)
        )
    )
    findings = run_bedrock_guardrails((_artifact(),), scanner)
    assert scanner.scanned == [_artifact().body_markdown]  # every artifact is scanned
    assert "guardrail_blocked" in _codes(findings, FindingSeverity.BLOCKING)


def test_passing_guardrail_yields_no_finding() -> None:
    scanner = InMemoryGuardrailScanner(GuardrailVerdict(blocked=False, action="NONE"))
    assert run_bedrock_guardrails((_artifact(),), scanner) == ()


def test_apply_check_outcomes_marks_blocked_artifact() -> None:
    findings = run_deterministic_policy_checks((_artifact(),), _resolved_claims())
    out = apply_check_outcomes((_artifact(),), findings)
    assert out[0].status == BLOCKED_STATUS  # fabricated metric blocked the artifact


# --- T5 — persist + Gate #2 -------------------------------------------------------


def test_persist_writes_claims_then_links() -> None:
    """AC: claims persist; only grounded claims carry a link (unlinkable never approvable)."""
    # Extract + link together so the claims and their links share ids.
    claims, _ = _extract_one_artifact()
    resolved, links = link_claims_to_evidence(
        claims, InMemoryClaimEvidenceMatcher(_EVIDENCE)
    )
    sink = InMemoryClaimSink()

    inserted = persist_claims(resolved, links, sink)

    assert inserted == tuple(c.claim_id for c in resolved)
    assert len(sink.claims) == 2
    # Every link references a claim that was inserted (FK ordering holds).
    claim_ids = {c.claim_id for c in sink.claims}
    assert all(link.claim_id in claim_ids for link in sink.links)
    # The unsupported ROI claim contributed no link.
    supported_ids = {
        c.claim_id
        for c in sink.claims
        if c.support_status == SupportStatus.SUPPORTED.value
    }
    assert {link.claim_id for link in sink.links} <= supported_ids


def test_build_gate2_payload_counts_blocked() -> None:
    findings = run_deterministic_policy_checks((_artifact(),), _resolved_claims())
    artifacts = apply_check_outcomes((_artifact(),), findings)
    payload = build_gate2_payload(
        _RUN_ID, "lg_thread_1", artifacts, "https://app.example.com/"
    )
    assert isinstance(payload, Gate2Payload)
    assert payload.artifacts_pending_review == 1
    assert payload.blocked_artifacts == 1
    assert payload.dashboard_url.endswith(f"/releases/{_RUN_ID}/artifacts/review")


def test_route_after_gate2() -> None:
    assert route_after_gate2(GateDecision.APPROVED) == "approved"
    assert route_after_gate2(GateDecision.REJECTED) == "persist_artifact_review"
    assert route_after_gate2(GateDecision.EDITED) == "persist_artifact_review"


def test_persist_artifact_review_applies_rejected_decision() -> None:
    sink = InMemoryArtifactReviewSink()
    affected = persist_artifact_review(GateDecision.REJECTED, (_artifact(),), sink)
    assert affected == (_ART_ID,)
    assert sink.updates == [(_ART_ID, "rejected")]


# --- T3 (spec 007) — all initial artifact types flow through claims uniformly ------


def test_all_initial_types_extract_and_check_uniformly() -> None:
    """T3/AC: every initial artifact type is decomposed into claims and run through the
    deterministic checks on the same path — none bypasses extraction or Gate #2 prep."""
    artifacts = tuple(
        _artifact_of(t, f"aaaaaaaa-1111-2222-3333-00000000000{i}")
        for i, t in enumerate(_INITIAL_ARTIFACT_TYPES)
    )
    client = RecordingModelClient(_CLAIM_RESPONSE)
    ids = (f"claim-{n}" for n in _claim_ids())

    claims = extract_claims(artifacts, client, lambda: next(ids))

    # Every artifact (regardless of type) is decomposed into the same 2 claims.
    by_artifact: dict[str, int] = {}
    for c in claims:
        by_artifact[c.artifact_id] = by_artifact.get(c.artifact_id, 0) + 1
    assert set(by_artifact) == {a.artifact_id for a in artifacts}
    assert set(by_artifact.values()) == {2}

    # Link + checks apply uniformly: each type's fabricated ROI metric blocks that artifact.
    resolved, _links = link_claims_to_evidence(
        claims, InMemoryClaimEvidenceMatcher(_EVIDENCE)
    )
    findings = run_deterministic_policy_checks(artifacts, resolved)
    blocked = apply_check_outcomes(artifacts, findings)
    blocked_types = {a.artifact_type for a in blocked if a.status == BLOCKED_STATUS}
    assert blocked_types == set(_INITIAL_ARTIFACT_TYPES)


def test_demo_script_claim_requires_evidence_linkage() -> None:
    """T3: a demo_script's claims are grounded by the identical rule — the capability claim
    links to evidence; the fabricated metric stays UNSUPPORTED with no link."""
    demo = _artifact_of("demo_script", "dddddddd-1111-2222-3333-444444444444")
    client = RecordingModelClient(_CLAIM_RESPONSE)
    ids = (f"claim-{n}" for n in _claim_ids())

    claims = extract_claims((demo,), client, lambda: next(ids))
    resolved, links = link_claims_to_evidence(
        claims, InMemoryClaimEvidenceMatcher(_EVIDENCE)
    )

    cap = next(c for c in resolved if "create reusable" in c.claim_text)
    roi = next(c for c in resolved if "50%" in c.claim_text)
    assert cap.support_status == SupportStatus.SUPPORTED.value
    assert any(link.claim_id == cap.claim_id for link in links)
    assert roi.support_status == SupportStatus.UNSUPPORTED.value
    assert all(link.claim_id != roi.claim_id for link in links)
