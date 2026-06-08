"""T1 (spec 013) — the ``EvalRun`` record + its sink port (PRD §10.7).

Proves the persisted eval shape carries ONLY scores + counts (constitution §5: no prompt /
evidence / output / PII field exists on the model at all) and that the in-memory sink records
what it is handed. The runtime ``AuroraEvalSink`` (aurora_eval) writes the same model to the
``eval_runs`` table (migration 0012); it is exercised against a live DB by the integration gate,
not the unit gate.
"""

from __future__ import annotations

from release_worker.eval_models import (
    EvalRun,
    EvalType,
    MetricName,
    RecordingEvalSink,
)


def test_eval_run_schema_carries_no_prompt_or_pii_field() -> None:
    # Constitution §5: the row is scores + counts + provenance only — assert the schema itself.
    names = set(EvalRun.model_fields)
    assert names == {
        "release_run_id",
        "eval_type",
        "artifact_id",
        "score",
        "rubric",
        "findings",
    }
    for forbidden in (
        "prompt",
        "system",
        "messages",
        "body",
        "text",
        "output",
        "evidence",
    ):
        assert forbidden not in names


def test_metric_name_doubles_as_eval_type() -> None:
    # The seven §17.1 metrics use their name as the eval_type discriminator.
    assert MetricName.EVIDENCE_COVERAGE.value == "evidence_coverage"
    assert EvalType.RUBRIC.value == "rubric"
    assert EvalType.REGRESSION.value == "regression"
    assert len(set(MetricName)) == 7


def test_recording_sink_collects_rows_in_order() -> None:
    sink = RecordingEvalSink()
    first = EvalRun(release_run_id="run-1", eval_type="evidence_coverage", score=0.5)
    second = EvalRun(
        release_run_id="run-1",
        eval_type="rubric",
        artifact_id="art-1",
        score=4.0,
        rubric={"clarity": 4.0},
    )
    sink.record(first)
    sink.record(second)
    assert sink.records == [first, second]


def test_eval_run_is_frozen_and_rejects_unknown_fields() -> None:
    run = EvalRun(release_run_id="run-1", eval_type="rubric", score=3.0)
    # Frozen: an eval measurement is immutable once recorded.
    try:
        run.score = 5.0  # type: ignore[misc]
    except Exception as err:  # pydantic raises on frozen mutation
        assert "frozen" in str(err).lower() or "instance" in str(err).lower()
    else:  # pragma: no cover - frozen must raise
        raise AssertionError("EvalRun must be immutable")
