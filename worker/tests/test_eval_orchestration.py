"""T6 (spec 013) — the eval-after-approval orchestration (PRD §17 / §8 DoD).

Exercises ``run_product_evaluation`` against in-memory fakes: it writes the seven deterministic
metrics PLUS one rubric row per approved artifact, scopes every row by ``release_run_id`` (§2),
and persists no artifact body (§5). This is the pure contract the worker's ``eval`` graph wires
the Aurora readers + Bedrock client into.
"""

from __future__ import annotations

from release_worker.engagement_models import EngagementTotals, StaticEngagementReader
from release_worker.eval_metrics import MetricInputs
from release_worker.eval_models import EvalType, MetricName, RecordingEvalSink
from release_worker.eval_orchestration import run_product_evaluation
from release_worker.eval_rubric import ArtifactBody, RubricDimension
from release_worker.model_client import RecordingModelClient


class _FakeMetricReader:
    def __init__(self, inputs: MetricInputs) -> None:
        self._inputs = inputs

    def read(self) -> MetricInputs:
        return self._inputs


class _FakeArtifactReader:
    def __init__(self, artifacts: tuple[ArtifactBody, ...]) -> None:
        self._artifacts = artifacts

    def approved_artifacts(self) -> tuple[ArtifactBody, ...]:
        return self._artifacts


_GOOD_SCORES = {dim.value: 5.0 for dim in RubricDimension}


def test_eval_writes_metrics_and_one_rubric_per_approved_artifact() -> None:
    sink = RecordingEvalSink()
    artifacts = (
        ArtifactBody("art-1", "release_blog", "T", "body one"),
        ArtifactBody("art-2", "changelog", "T", "body two"),
    )
    produced = run_product_evaluation(
        "run-1",
        _FakeMetricReader(MetricInputs(total_claims=2, claims_with_evidence=2)),
        _FakeArtifactReader(artifacts),
        RecordingModelClient(_GOOD_SCORES),
        sink,
    )
    metric_rows = [r for r in sink.records if r.eval_type in set(MetricName)]
    rubric_rows = [r for r in sink.records if r.eval_type == EvalType.RUBRIC.value]
    assert len(metric_rows) == 11
    assert len(rubric_rows) == 2
    assert {r.artifact_id for r in rubric_rows} == {"art-1", "art-2"}
    assert produced == tuple(sink.records)


def test_eval_rows_are_run_scoped_and_carry_no_body() -> None:
    sink = RecordingEvalSink()
    artifacts = (ArtifactBody("art-1", "release_blog", "Secret title", "secret body"),)
    run_product_evaluation(
        "run-1",
        _FakeMetricReader(MetricInputs()),
        _FakeArtifactReader(artifacts),
        RecordingModelClient(_GOOD_SCORES),
        sink,
    )
    assert all(r.release_run_id == "run-1" for r in sink.records)
    blob = "".join(r.model_dump_json() for r in sink.records)
    assert "secret body" not in blob
    assert "Secret title" not in blob


def test_eval_runs_metrics_even_with_no_approved_artifacts() -> None:
    sink = RecordingEvalSink()
    run_product_evaluation(
        "run-1",
        _FakeMetricReader(MetricInputs()),
        _FakeArtifactReader(()),
        RecordingModelClient(_GOOD_SCORES),
        sink,
    )
    assert len(sink.records) == 11  # metrics only; no rubric without artifacts


def _engagement_rows(sink: RecordingEvalSink) -> dict[str, float | None]:
    """The three spec-021 outcome rows, keyed by eval_type."""
    wanted = {
        MetricName.ENGAGEMENT_VIEWS_TOTAL.value,
        MetricName.ENGAGEMENT_CLICKS_TOTAL.value,
        MetricName.ENGAGEMENT_CONVERSIONS_TOTAL.value,
    }
    return {r.eval_type: r.score for r in sink.records if r.eval_type in wanted}


def test_eval_merges_engagement_totals_into_outcome_rows() -> None:
    # T1 (spec 021): a wired engagement reader lands the run's aggregate totals in
    # eval_runs; an unreported metric (conversions) stays None — never zero (spec AC).
    sink = RecordingEvalSink()
    reader = StaticEngagementReader(
        EngagementTotals(release_run_id="run-1", views=1200, clicks=37)
    )
    run_product_evaluation(
        "run-1",
        _FakeMetricReader(MetricInputs()),
        _FakeArtifactReader(()),
        RecordingModelClient(_GOOD_SCORES),
        sink,
        engagement_reader=reader,
    )
    rows = _engagement_rows(sink)
    assert rows[MetricName.ENGAGEMENT_VIEWS_TOTAL.value] == 1200.0
    assert rows[MetricName.ENGAGEMENT_CLICKS_TOTAL.value] == 37.0
    assert rows[MetricName.ENGAGEMENT_CONVERSIONS_TOTAL.value] is None


def test_eval_without_engagement_reader_reports_outcomes_as_unreported() -> None:
    # No reader wired (or nothing ingested) → every outcome row is score=None with a
    # findings flag — "not yet reported" must be distinguishable from 0 downstream.
    sink = RecordingEvalSink()
    run_product_evaluation(
        "run-1",
        _FakeMetricReader(MetricInputs()),
        _FakeArtifactReader(()),
        RecordingModelClient(_GOOD_SCORES),
        sink,
    )
    rows = _engagement_rows(sink)
    assert set(rows.values()) == {None}
    flags = {r.findings["reported"] for r in sink.records if r.eval_type in rows}
    assert flags == {"false"}
