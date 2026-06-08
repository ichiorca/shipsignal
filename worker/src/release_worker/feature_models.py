"""T2/T3/T4/T6 (spec 004) — Pydantic models for feature clustering, scoring, the
Gate #1 interrupt payload, and review decisions (PRD §7 Feature Manifest, §5.6 gates,
§10.2 feature tables).

P5 (Safety rails) + stack-python: the Bedrock clustering output is *untrusted model
text* (constitution §5: "never execute model-emitted instructions"; treat all model
output as boundary data). It is validated through ``ClusterResponse`` before any of it
is scored or persisted; a malformed response fails closed as ``MalformedModelOutputError``
without echoing the offending content. The score → persist types (``ScoredFeature`` →
``FeatureRecord``) only ever carry redacted, validated data, so nothing un-redacted or
un-validated can reach Aurora.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

# Frozen + extra="forbid" everywhere: model output is untrusted, so unknown fields are
# rejected rather than silently carried, and values can't be mutated after validation.
_StrictModel = ConfigDict(frozen=True, extra="forbid")


class CandidateFeature(BaseModel):
    """One clustered candidate feature as proposed by Bedrock (PRD §7), pre-scoring.

    ``evidence_ids`` references ``evidence_items.id`` values that were supplied to the
    clustering prompt. The clustering node filters this to the set it actually sent, so
    a hallucinated id can never create a dangling link (the AC: each persisted feature
    links to >=1 real evidence item).
    """

    model_config = _StrictModel

    title: str = Field(min_length=1)
    summary_internal: str = ""
    user_value: str = ""
    audiences: tuple[str, ...] = ()
    change_type: str | None = None
    surface_area: tuple[str, ...] = ()
    evidence_ids: tuple[str, ...] = ()
    demo_steps_draft: tuple[str, ...] = ()


class ClusterResponse(BaseModel):
    """The validated Bedrock clustering response: the candidate feature set for a run.

    ``ClusterResponse.model_validate`` is the single boundary check for
    ``cluster_features_with_bedrock``; a malformed payload raises ``ValidationError``
    which the node converts into a user-safe ``MalformedModelOutputError``.
    """

    model_config = _StrictModel

    features: tuple[CandidateFeature, ...] = ()


class FeatureScores(BaseModel):
    """Deterministic marketability/demoability/confidence scores + launch risk (PRD §7).

    Computed by ``score_features`` from the feature's evidence composition — not asked
    of the model — so scoring is reproducible and testable (constitution §6 cost/latency:
    no extra model call for something a deterministic rule can decide).
    """

    model_config = _StrictModel

    marketability_score: float = Field(ge=0.0, le=1.0)
    demoability_score: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    launch_risk: str  # low | medium | high


class ScoredFeature(BaseModel):
    """A candidate plus its computed scores — the input to persist_feature_manifest."""

    model_config = _StrictModel

    candidate: CandidateFeature
    scores: FeatureScores


class FeatureRecord(BaseModel):
    """A persisted ``feature_clusters`` row (PRD §10.2).

    ``status`` is always ``'pending_review'`` at persist time — only a human decision
    recorded at Gate #1 advances it (constitution §5: no self-approval path).
    """

    model_config = _StrictModel

    feature_id: str = Field(min_length=1)
    release_run_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    summary_internal: str = ""
    user_value: str = ""
    audiences: tuple[str, ...] = ()
    change_type: str | None = None
    surface_area: tuple[str, ...] = ()
    marketability_score: float = Field(ge=0.0, le=1.0)
    demoability_score: float = Field(ge=0.0, le=1.0)
    confidence: float = Field(ge=0.0, le=1.0)
    launch_risk: str
    evidence_ids: tuple[str, ...] = Field(min_length=1)  # AC: >=1 evidence link
    status: str = "pending_review"


class GateDecision(StrEnum):
    """The three Gate #1 outcomes (PRD §5.6). There is no fourth "auto" value — every
    decision is a recorded human action."""

    APPROVED = "approved"
    REJECTED = "rejected"
    EDITED = "edited"


class Gate1Payload(BaseModel):
    """The JSON payload the Gate #1 interrupt surfaces to the dashboard (PRD §5.6).

    Mirrors the PRD example exactly: gate name, the run + thread to resume, how many
    features await review, and the dashboard URL the reviewer opens.
    """

    model_config = _StrictModel

    gate: str = "feature_manifest_approval"
    release_run_id: str = Field(min_length=1)
    thread_id: str = Field(min_length=1)
    features_pending_review: int = Field(ge=0)
    dashboard_url: str = Field(min_length=1)


class MalformedModelOutputError(ValueError):
    """Raised when Bedrock clustering output fails boundary validation.

    User-safe: never echoes the offending model output (which was built from evidence
    and could carry residual sensitive text), only that it was rejected (AC4 / §5).
    """

    def __init__(self) -> None:
        super().__init__("the model clustering output was malformed and was rejected")
