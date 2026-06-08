"""T2/T3/T4/T5 (spec 006) — Pydantic models for claim extraction, evidence linking,
the deterministic + Guardrail checks, and the Gate #2 interrupt (PRD §8.3 claim-level
contract, §10.3 artifact_claims / claim_evidence_links, §5.6 Gate #2, §12.2/§12.3 checks).

P5 (Safety rails) + stack-python: every boundary payload here is a validated Pydantic v2
model, never a raw dict. Two untrusted boundaries matter:

* Claim extraction output is *untrusted model text* (constitution §5) — it is validated
  through ``ClaimExtractionResponse`` before any of it is persisted; a malformed payload
  fails closed as ``MalformedClaimOutputError`` without echoing the offending content.
* The Bedrock Guardrail verdict is likewise boundary data, validated into ``GuardrailVerdict``.

constitution §5 — claim-level provenance: an ``ArtifactClaim`` carries its
``support_status`` and the ``evidence_ids`` it links to; only ``link_claims_to_evidence``
can set ``support_status='supported'`` (and only by producing >=1 ``ClaimEvidenceLink``),
so an unsupported claim can never be persisted as approvable. The §18.3 audit trail lives in
``checker_metadata`` (per-claim) and the ``PolicyFinding`` set (per-artifact).
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

# Frozen + extra="forbid" everywhere: model output is untrusted, so unknown fields are
# rejected rather than silently carried, and values can't be mutated after validation.
_StrictModel = ConfigDict(frozen=True, extra="forbid")


class ClaimType(StrEnum):
    """The typed kinds of claim an artifact decomposes into (PRD §8.3).

    ``GENERAL`` is the deterministic fallback when the model proposes an unknown type, so
    a hallucinated claim_type can never smuggle an arbitrary string into Aurora."""

    CAPABILITY = "capability"
    PERFORMANCE = "performance"
    AVAILABILITY = "availability"
    COMPARISON = "comparison"
    SECURITY = "security"
    GENERAL = "general"


class SupportStatus(StrEnum):
    """Whether a claim is grounded in evidence (PRD §8.3). There is no 'auto-approved'
    value — ``SUPPORTED`` is set only by ``link_claims_to_evidence`` producing a real link."""

    SUPPORTED = "supported"
    UNSUPPORTED = "unsupported"


class RiskLevel(StrEnum):
    """A claim's launch risk (PRD §8.3). An unsupported HIGH-risk claim blocks its artifact
    (e.g. a fabricated ROI figure); ``MEDIUM`` is the fallback for an unknown model value."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class FindingSeverity(StrEnum):
    """How a policy/Guardrail finding gates the artifact. ``BLOCKING`` marks the artifact
    'blocked' (Gate #2 cannot approve it); ``ADVISORY`` flags it for the reviewer."""

    BLOCKING = "blocking"
    ADVISORY = "advisory"


# --- T2 — claim extraction (untrusted Bedrock output) -----------------------------


class ExtractedClaim(BaseModel):
    """One claim as proposed by Bedrock from an artifact body (PRD §8.3), pre-normalization.

    ``claim_type``/``risk_level`` are accepted as raw strings (untrusted) and normalized to
    the known enums by ``extract_claims``; only ``claim_text`` is required. The model never
    sets support_status — grounding is decided deterministically downstream (§5)."""

    model_config = _StrictModel

    claim_text: str = Field(min_length=1)
    claim_type: str = "general"
    risk_level: str = "medium"


class ClaimExtractionResponse(BaseModel):
    """The validated Bedrock claim-extraction response for one artifact.

    ``ClaimExtractionResponse.model_validate`` is the single boundary check for
    ``extract_claims``; a malformed payload raises ``ValidationError`` which the node
    converts into a user-safe ``MalformedClaimOutputError``."""

    model_config = _StrictModel

    claims: tuple[ExtractedClaim, ...] = ()


# --- T2/T3 — persisted claim + its evidence links ---------------------------------


class ArtifactClaim(BaseModel):
    """A persisted ``artifact_claims`` row (PRD §10.3), carrying its resolved evidence links.

    ``support_status`` starts ``UNSUPPORTED`` at extraction and is set to ``SUPPORTED`` only
    when ``link_claims_to_evidence`` finds >=1 grounding evidence item (then ``evidence_ids``
    is non-empty). ``checker_metadata`` holds the per-claim audit summary (max support score,
    why it was flagged) for the §18.3 trail. The claim is approvable at Gate #2 only when it
    is ``SUPPORTED`` (constitution §5: an unlinkable claim is never approved)."""

    model_config = _StrictModel

    claim_id: str = Field(min_length=1)
    artifact_id: str = Field(min_length=1)
    claim_text: str = Field(min_length=1)
    claim_type: str = Field(min_length=1)  # a ClaimType value
    support_status: str = SupportStatus.UNSUPPORTED.value
    risk_level: str = Field(min_length=1)  # a RiskLevel value
    evidence_ids: tuple[str, ...] = ()
    # str->str so a frozen jsonb-bound map stays trivially serialisable (e.g.
    # {"max_support_score": "0.42", "flags": "unsupported_claim"}).
    checker_metadata: dict[str, str] = Field(default_factory=dict)


class ClaimEvidenceLink(BaseModel):
    """A persisted ``claim_evidence_links`` row (PRD §10.3): a claim grounded in one
    evidence item with the deterministic ``support_score`` (0..1) that justified the link."""

    model_config = _StrictModel

    claim_id: str = Field(min_length=1)
    evidence_item_id: str = Field(min_length=1)
    support_score: float = Field(ge=0.0, le=1.0)


class ClaimEvidenceCandidate(BaseModel):
    """One candidate evidence item the matcher surfaced for a claim (PRD §11 claim grounding).

    ``similarity`` is the pgvector cosine similarity when a semantic ranking was available,
    else ``None``; the *binding* link decision is the deterministic lexical ``support_score``
    computed in ``link_claims_to_evidence`` (so a semantically-near but term-disjoint claim,
    like a fabricated metric, is not grounded)."""

    model_config = _StrictModel

    evidence_id: str = Field(min_length=1)
    redacted_excerpt: str = ""
    similarity: float | None = None


# --- T4 — deterministic + Guardrail check findings --------------------------------


class PolicyFinding(BaseModel):
    """One finding from the deterministic policy checks or Bedrock Guardrails (PRD §12.2/§12.3).

    ``code`` is a stable machine label (e.g. ``unsupported_claim``, ``unverified_metric``,
    ``secret_leak``, ``superlative``, ``guardrail_blocked``); ``severity`` decides whether it
    blocks the artifact. ``detail`` is user-safe — it never echoes a matched secret/PII value,
    only that a pattern fired (constitution §5)."""

    model_config = _StrictModel

    artifact_id: str = Field(min_length=1)
    claim_id: str | None = None
    code: str = Field(min_length=1)
    severity: str = Field(min_length=1)  # a FindingSeverity value
    detail: str = ""


class GuardrailVerdict(BaseModel):
    """The validated outcome of a Bedrock Guardrails ``ApplyGuardrail`` scan (PRD §12.2).

    ``blocked`` is the binding signal: a blocked artifact cannot reach Gate #2 approval. The
    raw provider action + intervened categories are carried for the audit trail (no PII)."""

    model_config = _StrictModel

    blocked: bool = False
    action: str = "NONE"
    categories: tuple[str, ...] = ()


# --- T5 — Gate #2 interrupt payload -----------------------------------------------


class Gate2Payload(BaseModel):
    """The JSON payload the Gate #2 (artifact-review) interrupt surfaces to the dashboard
    (PRD §5.6). Mirrors the Gate #1 shape: gate name, the run + thread to resume, how many
    artifacts await review, how many are blocked, and the dashboard URL the reviewer opens."""

    model_config = _StrictModel

    gate: str = "artifact_review"
    release_run_id: str = Field(min_length=1)
    thread_id: str = Field(min_length=1)
    artifacts_pending_review: int = Field(ge=0)
    blocked_artifacts: int = Field(ge=0)
    dashboard_url: str = Field(min_length=1)


class MalformedClaimOutputError(ValueError):
    """Raised when Bedrock claim-extraction output fails boundary validation.

    User-safe: never echoes the offending model output (built from artifact text, could
    carry residual sensitive content), only that it was rejected (constitution §5)."""

    def __init__(self) -> None:
        super().__init__("the model claim output was malformed and was rejected")
