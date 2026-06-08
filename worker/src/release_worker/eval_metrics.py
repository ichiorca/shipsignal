"""T2 (spec 013) — the deterministic product-quality metrics (PRD §17.1).

Pure computation: ``MetricInputs`` is the run-scoped aggregate the Aurora reader gathers
(counts + edit-distance/latency samples), and ``compute_product_metrics`` turns it into one
``EvalRun`` per §17.1 metric. No DB / no model — so the seven metric definitions are unit-tested
directly (constitution §6 cost: no I/O on the hot path here), and the runtime
``AuroraMetricInputsReader`` only has to fill the dataclass.

Constitution §5 — the inputs are already numbers (the reader reduced any text, e.g. the
edit-distance samples, to ratios before this layer), so nothing here can leak a prompt/PII into
an eval row. Constitution §2 — every produced ``EvalRun`` is scoped by ``release_run_id``.

Scoring convention: a rate metric with a zero denominator scores ``None`` (not 0.0) so the
dashboard shows "n/a" rather than a misleading 0 — e.g. coverage when a run produced no claims.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, field

from release_worker.eval_models import EvalRun, MetricName

# Bound the edit-distance DP: reviewer source/revised text can be long, and the metric only
# needs a stable rewrite *ratio*, so comparing the first N chars keeps it O(N^2)-bounded
# (constitution §6 cost) without changing the signal in practice.
_EDIT_DISTANCE_MAX_CHARS = 4000


@dataclass(frozen=True)
class MetricInputs:
    """The run-scoped aggregate the metric layer needs (PRD §17.1), gathered by the Aurora
    reader. Counts are plain ints; ``edit_distances`` and ``approval_latencies_seconds`` are
    per-sample values the reader already reduced from text/timestamps (so this layer stays
    text-free, §5). ``skill_candidate`` counts are repo-global (candidates carry no run id)."""

    total_claims: int = 0
    claims_with_evidence: int = 0
    unsupported_claims: int = 0
    total_features: int = 0
    rejected_features: int = 0
    total_skill_candidates: int = 0
    accepted_skill_candidates: int = 0
    total_media: int = 0
    ready_media: int = 0
    edit_distances: Sequence[float] = field(default_factory=tuple)
    approval_latencies_seconds: Sequence[float] = field(default_factory=tuple)


def normalized_edit_distance(a: str, b: str) -> float:
    """Levenshtein distance between ``a`` and ``b`` normalized to 0..1 (0 = identical, 1 =
    fully rewritten). Both empty → 0.0. Inputs are capped at ``_EDIT_DISTANCE_MAX_CHARS`` to
    bound the DP (constitution §6). Pure — the caller (the Aurora reader) discards the text and
    keeps only this ratio, so no reviewer text reaches the eval row (§5)."""
    s1 = a[:_EDIT_DISTANCE_MAX_CHARS]
    s2 = b[:_EDIT_DISTANCE_MAX_CHARS]
    if not s1 and not s2:
        return 0.0
    longest = max(len(s1), len(s2))
    # Classic two-row DP; O(len(s1) * len(s2)) time, O(len(s2)) space.
    previous = list(range(len(s2) + 1))
    for i, ch1 in enumerate(s1, start=1):
        current = [i]
        for j, ch2 in enumerate(s2, start=1):
            cost = 0 if ch1 == ch2 else 1
            current.append(
                min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
            )
        previous = current
    return previous[len(s2)] / longest


def _rate(numerator: int, denominator: int) -> float | None:
    """A 0..1 rate, or ``None`` when there is nothing to rate (zero denominator)."""
    if denominator <= 0:
        return None
    return numerator / denominator


def _mean(samples: Sequence[float]) -> float | None:
    """The mean of a sample set, or ``None`` when there are no samples."""
    if not samples:
        return None
    return sum(samples) / len(samples)


def _metric(
    release_run_id: str,
    name: MetricName,
    score: float | None,
    findings: dict[str, object],
) -> EvalRun:
    """Build one metric ``EvalRun``: the metric name is the ``eval_type`` (no rubric map)."""
    return EvalRun(
        release_run_id=release_run_id,
        eval_type=name.value,
        score=score,
        findings=findings,
    )


def compute_product_metrics(
    release_run_id: str, inputs: MetricInputs
) -> tuple[EvalRun, ...]:
    """Compute all seven §17.1 metrics for a run, in PRD order (deterministic for the
    dashboard/tests). Each is a run-level ``EvalRun`` (no ``artifact_id``); ``findings`` carry
    the numerator/denominator or sample count so a reviewer can see *why* a score is what it
    is — counts only, never text (§5)."""
    return (
        _metric(
            release_run_id,
            MetricName.EVIDENCE_COVERAGE,
            _rate(inputs.claims_with_evidence, inputs.total_claims),
            {
                "numerator": inputs.claims_with_evidence,
                "denominator": inputs.total_claims,
            },
        ),
        _metric(
            release_run_id,
            MetricName.UNSUPPORTED_CLAIM_RATE,
            _rate(inputs.unsupported_claims, inputs.total_claims),
            {
                "numerator": inputs.unsupported_claims,
                "denominator": inputs.total_claims,
            },
        ),
        _metric(
            release_run_id,
            MetricName.EDIT_DISTANCE,
            _mean(inputs.edit_distances),
            {"sample_count": len(inputs.edit_distances)},
        ),
        _metric(
            release_run_id,
            MetricName.APPROVAL_LATENCY_SECONDS,
            _mean(inputs.approval_latencies_seconds),
            {"sample_count": len(inputs.approval_latencies_seconds)},
        ),
        _metric(
            release_run_id,
            MetricName.FEATURE_REJECTION_RATE,
            _rate(inputs.rejected_features, inputs.total_features),
            {
                "numerator": inputs.rejected_features,
                "denominator": inputs.total_features,
            },
        ),
        _metric(
            release_run_id,
            MetricName.SKILL_CANDIDATE_ACCEPTANCE_RATE,
            _rate(inputs.accepted_skill_candidates, inputs.total_skill_candidates),
            {
                "numerator": inputs.accepted_skill_candidates,
                "denominator": inputs.total_skill_candidates,
                # Candidates are not run-scoped (§10.5); flag the repo-global scope so the
                # dashboard doesn't read it as run-local.
                "scope": "repo_global",
            },
        ),
        _metric(
            release_run_id,
            MetricName.MEDIA_SUCCESS_RATE,
            _rate(inputs.ready_media, inputs.total_media),
            {"numerator": inputs.ready_media, "denominator": inputs.total_media},
        ),
    )
