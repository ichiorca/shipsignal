"""T4 (spec 013) — the internal gold set + regression harness (PRD §17.3).

Loads the real checked-in gold set (proving it parses + is non-empty + complete), then drives
the regression harness through its public surface: a clean pipeline passes; a dropped feature, a
leaked non-marketable change, and a missed risky claim each fail the case; a missing output
fails closed; and ``regression_eval_run`` reports the pass fraction.
"""

from __future__ import annotations

from release_worker.gold_set import load_gold_set
from release_worker.regression import (
    PipelineOutput,
    evaluate_case,
    regression_eval_run,
    run_regression,
)


def test_checked_in_gold_set_loads_and_is_complete() -> None:
    gold = load_gold_set()
    assert len(gold.cases) >= 2
    for case in gold.cases:
        # Every §17.3 element is present (the loader enforces min_length=1, re-assert here).
        assert case.base_ref and case.head_ref
        assert case.expected_marketable_features
        assert case.approved_copy
        assert case.non_marketable_changes
        assert case.risky_claims


def _clean_output_for(case) -> PipelineOutput:
    return PipelineOutput(
        surfaced_features=case.expected_marketable_features,
        flagged_risky_claims=case.risky_claims,
    )


def test_clean_pipeline_passes_every_case() -> None:
    gold = load_gold_set()
    outputs = {c.case_id: _clean_output_for(c) for c in gold.cases}
    report = run_regression(gold, outputs)
    assert report.all_passed
    assert report.passed_count == report.total


def test_dropped_feature_fails_the_case() -> None:
    case = load_gold_set().cases[0]
    # Surface only the SECOND expected feature; the first is missing.
    output = PipelineOutput(
        surfaced_features=(case.expected_marketable_features[-1],),
        flagged_risky_claims=case.risky_claims,
    )
    result = evaluate_case(case, output)
    assert not result.passed
    assert case.expected_marketable_features[0] in result.missing_features


def test_leaked_non_marketable_change_fails_the_case() -> None:
    case = load_gold_set().cases[0]
    output = PipelineOutput(
        surfaced_features=case.expected_marketable_features
        + (case.non_marketable_changes[0],),
        flagged_risky_claims=case.risky_claims,
    )
    result = evaluate_case(case, output)
    assert not result.passed
    assert case.non_marketable_changes[0] in result.leaked_non_marketable


def test_missed_risky_claim_fails_the_case() -> None:
    case = load_gold_set().cases[0]
    output = PipelineOutput(
        surfaced_features=case.expected_marketable_features,
        flagged_risky_claims=(),  # flagged nothing risky → regression in the claim gate
    )
    result = evaluate_case(case, output)
    assert not result.passed
    assert result.missed_risky_claims == case.risky_claims


def test_missing_output_fails_closed() -> None:
    gold = load_gold_set()
    # Provide no outputs at all: every case scored against an empty output → all fail.
    report = run_regression(gold, {})
    assert report.passed_count == 0
    assert not report.all_passed


def test_regression_eval_run_reports_pass_fraction() -> None:
    gold = load_gold_set()
    outputs = {c.case_id: _clean_output_for(c) for c in gold.cases}
    report = run_regression(gold, outputs)
    eval_run = regression_eval_run("run-1", report)
    assert eval_run.eval_type == "regression"
    assert eval_run.release_run_id == "run-1"
    assert eval_run.score == 1.0
    assert eval_run.findings == {"passed": report.total, "total": report.total}
