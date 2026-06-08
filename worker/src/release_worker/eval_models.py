"""T1 (spec 013) — the eval-run record, its metric vocabulary, and the persistence port.

PRD §10.7 (eval_runs) / §17 (metrics + rubric). One ``EvalRun`` is the validated, PII-free
payload written to the ``eval_runs`` table (migration 0012): which run (+ optional artifact),
the ``eval_type`` discriminator, the single numeric ``score``, the per-dimension ``rubric``
map, and the aggregate ``findings``.

Constitution §5 — an ``EvalRun`` carries ONLY numbers and aggregate counts/labels: no prompt,
no evidence, no model output, no reviewer free-text (the rubric stores dimension *scores*, the
findings store *counts* and an override *flag* — never the artifact body). Constitution §2 —
every row is scoped by ``release_run_id``. The runtime Aurora adapter (``aurora_eval``)
persists it; the in-memory ``RecordingEvalSink`` lets the unit gate assert what was recorded
without a DB (mirrors ``cost_telemetry.RecordingTelemetrySink``).
"""

from __future__ import annotations

from enum import StrEnum
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

# Frozen + extra="forbid": an eval row is an immutable measurement, and forbidding unknown
# fields keeps a stray prompt/PII key from ever being smuggled onto the record (§5).
_StrictModel = ConfigDict(frozen=True, extra="forbid")


class EvalType(StrEnum):
    """The non-metric ``eval_type`` discriminators. Deterministic product metrics use their
    ``MetricName`` value directly as the eval_type, so a single column distinguishes a metric
    row (e.g. ``evidence_coverage``) from a ``rubric`` or ``regression`` row."""

    RUBRIC = "rubric"
    REGRESSION = "regression"


class MetricName(StrEnum):
    """The seven product-quality metrics (PRD §17.1). The value doubles as the row's
    ``eval_type`` so the dashboard/read-API can filter metrics by name."""

    EVIDENCE_COVERAGE = "evidence_coverage"
    UNSUPPORTED_CLAIM_RATE = "unsupported_claim_rate"
    EDIT_DISTANCE = "edit_distance"
    APPROVAL_LATENCY_SECONDS = "approval_latency_seconds"
    FEATURE_REJECTION_RATE = "feature_rejection_rate"
    SKILL_CANDIDATE_ACCEPTANCE_RATE = "skill_candidate_acceptance_rate"
    MEDIA_SUCCESS_RATE = "media_success_rate"


class EvalRun(BaseModel):
    """One persisted ``eval_runs`` row (PRD §10.7), scoped by ``release_run_id`` (§2).

    ``eval_type`` is a ``MetricName`` value, ``EvalType.RUBRIC``, or ``EvalType.REGRESSION``.
    ``score`` is the single numeric headline (a 0..1 rate, a mean latency in seconds, or a
    1..5 rubric mean) and is ``None`` only when a metric has no denominator. ``rubric`` holds
    per-dimension scores; ``findings`` holds aggregate counts + an optional human-override flag.
    Neither map may carry prompt/evidence/output text (§5) — the writers populate them with
    numbers and short machine labels only."""

    model_config = _StrictModel

    release_run_id: str = Field(min_length=1)
    eval_type: str = Field(min_length=1)
    artifact_id: str | None = None
    score: float | None = None
    # dimension -> score (e.g. {"clarity": 4.0}); empty for a deterministic-metric row.
    rubric: dict[str, float] = Field(default_factory=dict)
    # short machine labels/counts only (e.g. {"numerator": 7, "denominator": 9,
    # "human_override": "true"}); never artifact text (§5).
    findings: dict[str, object] = Field(default_factory=dict)


@runtime_checkable
class EvalRunSink(Protocol):
    """Persist one ``EvalRun``, scoped by ``release_run_id`` (constitution §2). The runtime
    ``AuroraEvalSink`` satisfies it; ``RecordingEvalSink`` is the unit-gate fake."""

    def record(self, eval_run: EvalRun) -> None: ...


class RecordingEvalSink:
    """In-memory ``EvalRunSink`` fake. Tests inspect ``.records`` to assert the persisted
    scores/findings and that no prompt/PII field exists on the schema at all (§5)."""

    def __init__(self) -> None:
        self.records: list[EvalRun] = []

    def record(self, eval_run: EvalRun) -> None:
        self.records.append(eval_run)
