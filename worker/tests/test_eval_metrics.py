"""T2 (spec 013) / T5 (spec 020) — the deterministic product metrics (PRD §17.1).

Exercises ``compute_product_metrics`` through the public surface: the seven §17.1 metrics
plus the spec-020 notify→decision latency split, in ``MetricName`` order, with the right
scores; the zero-denominator → ``None`` convention; and the pure
``normalized_edit_distance`` the Aurora reader uses to reduce reviewer text to a ratio before it
reaches a row (§5).
"""

from __future__ import annotations

from release_worker.eval_metrics import (
    MetricInputs,
    compute_product_metrics,
    normalized_edit_distance,
)
from release_worker.eval_models import MetricName


def _by_name(release_run_id: str, inputs: MetricInputs) -> dict[str, float | None]:
    return {
        run.eval_type: run.score
        for run in compute_product_metrics(release_run_id, inputs)
    }


def test_all_metrics_emitted_in_metricname_order_and_run_scoped() -> None:
    runs = compute_product_metrics("run-1", MetricInputs())
    assert tuple(r.eval_type for r in runs) == tuple(m.value for m in MetricName)
    assert all(r.release_run_id == "run-1" for r in runs)
    # Run-level metrics are not artifact-scoped.
    assert all(r.artifact_id is None for r in runs)


def test_rate_metrics_compute_expected_fractions() -> None:
    inputs = MetricInputs(
        total_claims=10,
        claims_with_evidence=8,
        unsupported_claims=3,
        total_features=4,
        rejected_features=1,
        total_skill_candidates=5,
        accepted_skill_candidates=2,
        total_media=4,
        ready_media=3,
    )
    scores = _by_name("run-1", inputs)
    assert scores[MetricName.EVIDENCE_COVERAGE.value] == 0.8
    assert scores[MetricName.UNSUPPORTED_CLAIM_RATE.value] == 0.3
    assert scores[MetricName.FEATURE_REJECTION_RATE.value] == 0.25
    assert scores[MetricName.SKILL_CANDIDATE_ACCEPTANCE_RATE.value] == 0.4
    assert scores[MetricName.MEDIA_SUCCESS_RATE.value] == 0.75


def test_zero_denominator_scores_none_not_zero() -> None:
    # No claims/features/media/candidates yet → "n/a", never a misleading 0.0.
    scores = _by_name("run-1", MetricInputs())
    assert scores[MetricName.EVIDENCE_COVERAGE.value] is None
    assert scores[MetricName.UNSUPPORTED_CLAIM_RATE.value] is None
    assert scores[MetricName.FEATURE_REJECTION_RATE.value] is None
    assert scores[MetricName.SKILL_CANDIDATE_ACCEPTANCE_RATE.value] is None
    assert scores[MetricName.MEDIA_SUCCESS_RATE.value] is None


def test_edit_distance_and_latency_are_sample_means_with_counts() -> None:
    inputs = MetricInputs(
        edit_distances=(0.2, 0.4),
        approval_latencies_seconds=(100.0, 300.0),
    )
    runs = {r.eval_type: r for r in compute_product_metrics("run-1", inputs)}
    edit = runs[MetricName.EDIT_DISTANCE.value]
    latency = runs[MetricName.APPROVAL_LATENCY_SECONDS.value]
    assert abs(edit.score - 0.3) < 1e-9
    assert edit.findings["sample_count"] == 2
    assert latency.score == 200.0
    assert latency.findings["sample_count"] == 2


def test_notify_to_decision_latency_renders_next_to_approval_latency() -> None:
    # T5 (spec 020) AC: the notify→decision split is surfaced ALONGSIDE approval latency,
    # so it is emitted immediately after it (the dashboard renders in this order).
    inputs = MetricInputs(notify_to_decision_latencies_seconds=(60.0, 180.0))
    runs = compute_product_metrics("run-1", inputs)
    order = [r.eval_type for r in runs]
    approval_index = order.index(MetricName.APPROVAL_LATENCY_SECONDS.value)
    notify_index = order.index(MetricName.NOTIFY_TO_DECISION_LATENCY_SECONDS.value)
    assert notify_index == approval_index + 1
    split = runs[notify_index]
    assert split.score == 120.0
    assert split.findings == {"sample_count": 2}


def test_empty_samples_score_none() -> None:
    runs = {r.eval_type: r for r in compute_product_metrics("run-1", MetricInputs())}
    assert runs[MetricName.EDIT_DISTANCE.value].score is None
    assert runs[MetricName.APPROVAL_LATENCY_SECONDS.value].score is None
    assert runs[MetricName.NOTIFY_TO_DECISION_LATENCY_SECONDS.value].score is None


def test_findings_carry_numerator_and_denominator_only() -> None:
    inputs = MetricInputs(total_claims=10, claims_with_evidence=8)
    runs = {r.eval_type: r for r in compute_product_metrics("run-1", inputs)}
    coverage = runs[MetricName.EVIDENCE_COVERAGE.value]
    assert coverage.findings == {"numerator": 8, "denominator": 10}
    # The skill-candidate metric flags its repo-global scope.
    skill = runs[MetricName.SKILL_CANDIDATE_ACCEPTANCE_RATE.value]
    assert skill.findings["scope"] == "repo_global"


def test_engagement_totals_score_counts_and_flag_reported() -> None:
    # T1 (spec 021): reported totals land as count scores with a reported=true flag.
    inputs = MetricInputs(engagement_views=1200, engagement_clicks=37)
    runs = {r.eval_type: r for r in compute_product_metrics("run-1", inputs)}
    views = runs[MetricName.ENGAGEMENT_VIEWS_TOTAL.value]
    assert views.score == 1200.0
    assert views.findings == {"reported": "true", "scope": "run_total"}
    assert runs[MetricName.ENGAGEMENT_CLICKS_TOTAL.value].score == 37.0


def test_unreported_engagement_scores_none_never_zero() -> None:
    # Spec AC: missing engagement is "not yet reported", NEVER zero. A reported zero is
    # a real measurement and must stay 0.0.
    runs = {r.eval_type: r for r in compute_product_metrics("run-1", MetricInputs())}
    for name in (
        MetricName.ENGAGEMENT_VIEWS_TOTAL,
        MetricName.ENGAGEMENT_CLICKS_TOTAL,
        MetricName.ENGAGEMENT_CONVERSIONS_TOTAL,
    ):
        assert runs[name.value].score is None
        assert runs[name.value].findings["reported"] == "false"

    reported_zero = MetricInputs(engagement_clicks=0)
    zero_runs = {
        r.eval_type: r for r in compute_product_metrics("run-1", reported_zero)
    }
    assert zero_runs[MetricName.ENGAGEMENT_CLICKS_TOTAL.value].score == 0.0
    assert (
        zero_runs[MetricName.ENGAGEMENT_CLICKS_TOTAL.value].findings["reported"]
        == "true"
    )


def test_normalized_edit_distance_bounds() -> None:
    assert normalized_edit_distance("", "") == 0.0
    assert normalized_edit_distance("abc", "abc") == 0.0
    # One substitution out of three characters.
    assert abs(normalized_edit_distance("abc", "abd") - (1 / 3)) < 1e-9
    # Fully different, equal length → 1.0.
    assert normalized_edit_distance("aaaa", "bbbb") == 1.0


def test_media_success_rate_not_applicable_when_demo_script_deselected() -> None:
    # T4 (spec 022) AC: a run that deselected demo_script reports media_success_rate as
    # not-applicable (score None + an explanatory findings label), even if media counts
    # are nonzero (they cannot legitimately be — defence against drift).
    inputs = MetricInputs(total_media=2, ready_media=2, demo_script_selected=False)
    runs = {r.eval_type: r for r in compute_product_metrics("run-1", inputs)}
    media = runs[MetricName.MEDIA_SUCCESS_RATE.value]
    assert media.score is None
    assert media.findings == {"not_applicable": "demo_script_not_selected"}


def test_media_success_rate_unchanged_when_demo_script_selected() -> None:
    # With demo_script selected (the default) the rate and findings are the pre-022 shape.
    inputs = MetricInputs(total_media=4, ready_media=3)
    runs = {r.eval_type: r for r in compute_product_metrics("run-1", inputs)}
    media = runs[MetricName.MEDIA_SUCCESS_RATE.value]
    assert media.score == 0.75
    assert media.findings == {"numerator": 3, "denominator": 4}
