"""T3 (spec 013) — the LLM-as-judge rubric (PRD §17.2) over the ``ModelClient`` seam.

PRD §17.2 scores eight dimensions — claim support, claim risk, brand voice, audience
relevance, originality, conversion intent, clarity, demoability — with "LLM-as-judge plus human
review". This module owns the prompt + the untrusted-output validation; the model transport is
the existing ``ModelClient`` Protocol (constitution §3 / §1: Bedrock Converse is the only model
path — no direct boto3 here), so the rubric runs under the same routing/budget/Guardrail seam
as every other call and is unit-tested against the in-memory fake.

Fail-closed (constitution §5 / AC): the judge's output is untrusted; a payload missing a
dimension or scoring out of 1..5 raises ``MalformedRubricOutputError`` WITHOUT echoing the
content. The persisted ``EvalRun`` carries only the per-dimension numeric scores + an
overall mean — never the artifact body or any judge rationale (§5). Human-review overrides are
recorded into the eval ``findings`` (``apply_human_override``) so the dashboard shows that a
human corrected the machine.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from release_worker.eval_models import EvalRun, EvalType
from release_worker.model_client import ModelClient

# The routing key the rubric passes to ``generate_json``; matched by the ``evaluate_rubric``
# NodeRoute (model_routing) so the judge is tiered + budgeted like any other node (§6). The
# artifact type is appended for provenance but the route resolves on the prefix.
_RUBRIC_TASK_PREFIX = "evaluate_rubric"
_RUBRIC_SCORE_MIN = 1.0
_RUBRIC_SCORE_MAX = 5.0


class RubricDimension(StrEnum):
    """The eight LLM-as-judge dimensions (PRD §17.2), scored 1 (poor) .. 5 (excellent)."""

    CLAIM_SUPPORT = "claim_support"
    CLAIM_RISK = "claim_risk"
    BRAND_VOICE = "brand_voice"
    AUDIENCE_RELEVANCE = "audience_relevance"
    ORIGINALITY = "originality"
    CONVERSION_INTENT = "conversion_intent"
    CLARITY = "clarity"
    DEMOABILITY = "demoability"


@dataclass(frozen=True)
class ArtifactBody:
    """An approved artifact's text, the rubric's input. The body enters the judge *prompt*
    only; it is never persisted onto the eval row (§5)."""

    artifact_id: str
    artifact_type: str
    title: str
    body_markdown: str


class RubricScores(BaseModel):
    """The validated judge output: one 1..5 score per dimension (PRD §17.2).

    ``extra="forbid"`` + the range bounds make a hallucinated/garbled payload fail boundary
    validation (→ ``MalformedRubricOutputError``) instead of polluting the eval row. No
    free-text/rationale field exists by construction, so the judge's prose can never reach
    Aurora (§5)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    claim_support: float = Field(ge=_RUBRIC_SCORE_MIN, le=_RUBRIC_SCORE_MAX)
    claim_risk: float = Field(ge=_RUBRIC_SCORE_MIN, le=_RUBRIC_SCORE_MAX)
    brand_voice: float = Field(ge=_RUBRIC_SCORE_MIN, le=_RUBRIC_SCORE_MAX)
    audience_relevance: float = Field(ge=_RUBRIC_SCORE_MIN, le=_RUBRIC_SCORE_MAX)
    originality: float = Field(ge=_RUBRIC_SCORE_MIN, le=_RUBRIC_SCORE_MAX)
    conversion_intent: float = Field(ge=_RUBRIC_SCORE_MIN, le=_RUBRIC_SCORE_MAX)
    clarity: float = Field(ge=_RUBRIC_SCORE_MIN, le=_RUBRIC_SCORE_MAX)
    demoability: float = Field(ge=_RUBRIC_SCORE_MIN, le=_RUBRIC_SCORE_MAX)

    def as_map(self) -> dict[str, float]:
        """The dimension→score map persisted as ``rubric_json``."""
        return {dim.value: float(getattr(self, dim.value)) for dim in RubricDimension}

    def overall(self) -> float:
        """The headline rubric score: the mean across the eight dimensions."""
        scores = self.as_map().values()
        return sum(scores) / len(scores)


class MalformedRubricOutputError(ValueError):
    """Raised when the judge output fails boundary validation.

    User-safe: never echoes the offending model output (built over the artifact body, could
    carry residual content), only that it was rejected (constitution §5)."""

    def __init__(self) -> None:
        super().__init__("the rubric judge output was malformed and was rejected")


# JSON schema handed to Converse: an object with one numeric 1..5 score per dimension and no
# additional properties. Built from the enum so the schema and ``RubricScores`` never drift.
_RUBRIC_SCHEMA: dict[str, object] = {
    "type": "object",
    "additionalProperties": False,
    "required": [dim.value for dim in RubricDimension],
    "properties": {
        dim.value: {
            "type": "number",
            "minimum": _RUBRIC_SCORE_MIN,
            "maximum": _RUBRIC_SCORE_MAX,
        }
        for dim in RubricDimension
    },
}

_SYSTEM_PROMPT = (
    "You are a strict marketing-content quality judge. Score the artifact on each of the "
    "eight dimensions from 1 (poor) to 5 (excellent): claim_support (claims are backed by "
    "evidence), claim_risk (5 = low risk, 1 = risky/unsupportable claims), brand_voice, "
    "audience_relevance, originality, conversion_intent, clarity, and demoability. Judge only "
    "the text provided. Return strict JSON matching the schema — one number per dimension, no "
    "prose, no extra keys."
)


def _idempotency_key(artifact: ArtifactBody) -> str:
    """Deterministic dedupe key (aws-bedrock-rules: Converse has none of its own). Same
    artifact id + body → same key, so a retried eval neither re-bills nor double-scores."""
    digest = hashlib.sha256()
    digest.update(_RUBRIC_TASK_PREFIX.encode("utf-8"))
    digest.update(b"\x00")
    digest.update(artifact.artifact_id.encode("utf-8"))
    digest.update(b"\x00")
    digest.update(artifact.body_markdown.encode("utf-8"))
    return digest.hexdigest()


def score_rubric(
    artifact: ArtifactBody,
    model_client: ModelClient,
    release_run_id: str,
) -> EvalRun:
    """Run the LLM-as-judge rubric over one approved artifact and return its ``EvalRun``.

    The prompt carries the artifact's title + body; the output is validated through
    ``RubricScores`` (fail-closed on malformed) and reduced to per-dimension scores + an
    overall mean. The persisted row is artifact-scoped (``artifact_id`` set) and carries
    numbers only (§5)."""
    messages = [
        {
            "role": "user",
            "content": f"Title: {artifact.title}\n\n{artifact.body_markdown}",
        }
    ]
    raw = model_client.generate_json(
        f"{_RUBRIC_TASK_PREFIX}_{artifact.artifact_type}",
        _SYSTEM_PROMPT,
        messages,
        _RUBRIC_SCHEMA,
        _idempotency_key(artifact),
    )
    try:
        scores = RubricScores.model_validate(raw)
    except ValidationError as err:
        raise MalformedRubricOutputError() from err
    return EvalRun(
        release_run_id=release_run_id,
        eval_type=EvalType.RUBRIC.value,
        artifact_id=artifact.artifact_id,
        score=scores.overall(),
        rubric=scores.as_map(),
        findings={"human_override": "false"},
    )


def apply_human_override(
    eval_run: EvalRun,
    overrides: dict[str, float],
    reviewer: str,
) -> EvalRun:
    """Record a human's correction of the machine rubric (PRD §17.2 "plus human review").

    Returns a NEW ``EvalRun`` with the overridden dimensions replaced, the headline score
    recomputed as the new mean, and ``findings`` noting the override + the reviewer + which
    dimensions changed (constitution §5: the reviewer *name* is operational metadata, not
    artifact content; no free-text rationale is stored). Unknown dimensions or out-of-range
    scores are rejected (fail-closed) so an override can't smuggle a bad value past the bounds
    the judge schema enforces."""
    if not eval_run.rubric:
        raise ValueError("cannot override a non-rubric eval run")
    merged = dict(eval_run.rubric)
    for dimension, score in overrides.items():
        if dimension not in merged:
            raise ValueError(f"unknown rubric dimension: {dimension}")
        if not _RUBRIC_SCORE_MIN <= score <= _RUBRIC_SCORE_MAX:
            raise ValueError("override score out of the 1..5 range")
        merged[dimension] = float(score)
    overall = sum(merged.values()) / len(merged)
    findings = {
        **eval_run.findings,
        "human_override": "true",
        "override_reviewer": reviewer,
        # Sorted for a deterministic, comma-joined label (no free text).
        "overridden_dimensions": ",".join(sorted(overrides)),
    }
    return eval_run.model_copy(
        update={"score": overall, "rubric": merged, "findings": findings}
    )
