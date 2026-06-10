"""T6 (spec 013) — the product-evaluation step that runs after artifact approval.

PRD §17 / constitution §8: once a run's artifacts are Gate#2-approved, evaluate the shipped
quality — compute the deterministic §17.1 metrics and run the §17.2 LLM-as-judge rubric over
each approved artifact — and persist every result to ``eval_runs``. This module is the pure
orchestration (no psycopg/boto3): it depends on narrow reader/sink Protocols, so the whole
"eval after approval writes the right rows and nothing leaks" contract is unit-tested against
fakes. ``__main__`` wires the Aurora readers + the Bedrock model client + ``AuroraEvalSink``
into it on the Actions runner (constitution §1: the Vercel app never runs this).

Constitution §2 — every written row is scoped by ``release_run_id``. Constitution §5 — only
scores + counts are persisted; the artifact body the rubric reads never reaches a row.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Protocol, runtime_checkable

from release_worker.engagement_models import EngagementTotalsReader
from release_worker.eval_metrics import MetricInputs, compute_product_metrics
from release_worker.eval_models import EvalRun, EvalRunSink
from release_worker.eval_rubric import ArtifactBody, score_rubric
from release_worker.model_client import ModelClient


@runtime_checkable
class MetricInputsReader(Protocol):
    """Gather a run's aggregate state for the deterministic metrics (PRD §17.1).
    ``AuroraMetricInputsReader`` satisfies it at runtime."""

    def read(self) -> MetricInputs: ...


@runtime_checkable
class ApprovedArtifactReader(Protocol):
    """Surface a run's Gate#2-approved artifact bodies for the rubric (PRD §17.2).
    ``AuroraApprovedArtifactReader`` satisfies it at runtime."""

    def approved_artifacts(self) -> tuple[ArtifactBody, ...]: ...


def run_product_evaluation(
    release_run_id: str,
    metric_inputs_reader: MetricInputsReader,
    approved_artifact_reader: ApprovedArtifactReader,
    model_client: ModelClient,
    sink: EvalRunSink,
    engagement_reader: EngagementTotalsReader | None = None,
) -> tuple[EvalRun, ...]:
    """Evaluate one run after artifact approval and persist every result (PRD §17, §8 DoD).

    Order: the deterministic metrics first (cheap, no model), then the LLM-as-judge
    rubric per approved artifact. Each ``EvalRun`` is recorded as it is produced and also
    returned (newest last) so the caller can log a summary. A malformed rubric payload raises
    ``MalformedRubricOutputError`` from ``score_rubric`` (fail-closed, §5) — the metrics already
    persisted stay, and the run is surfaced as failed rather than silently scoring garbage.

    T1 (spec 021): when an ``engagement_reader`` is wired, the run's aggregate engagement
    totals are merged into the inputs so the §17.1 outcome metrics land in ``eval_runs``
    next to the quality metrics. ``None`` keeps the outcome rows at "not yet reported"
    (score None), so an unwired eval (or a run with no ingested engagement) never reads
    as zero engagement."""
    inputs = metric_inputs_reader.read()
    if engagement_reader is not None:
        totals = engagement_reader.totals()
        inputs = replace(
            inputs,
            engagement_views=totals.views,
            engagement_clicks=totals.clicks,
            engagement_conversions=totals.conversions,
        )
    produced: list[EvalRun] = []
    for metric in compute_product_metrics(release_run_id, inputs):
        sink.record(metric)
        produced.append(metric)
    for artifact in approved_artifact_reader.approved_artifacts():
        rubric_run = score_rubric(artifact, model_client, release_run_id)
        sink.record(rubric_run)
        produced.append(rubric_run)
    return tuple(produced)
