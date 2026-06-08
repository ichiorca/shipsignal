"""T4 (spec 013) — the gold-set regression harness (PRD §17.3).

"Use [the gold set] to regression-test graph/prompt/model changes." Given what the CURRENT
pipeline produced for a gold case — the marketable features it surfaced and the claims it
flagged risky — this harness deterministically scores it against the gold expectations and
reports drift:

* a *missing feature* — an expected marketable feature the pipeline failed to surface
  (a prompt/model change made clustering blind to a real feature);
* a *leaked non-marketable change* — internal noise the pipeline wrongly marketed
  (clustering got noisier);
* a *missed risky claim* — a known risky/unsupported claim the checks failed to flag
  (a regression in the safety-critical claim gate, the worst kind).

Pure + deterministic (no model / no DB): the runner takes canned ``PipelineOutput`` so the unit
gate exercises the exact scoring the eval step uses. ``regression_eval_run`` turns a report into
a persisted ``EvalRun`` (constitution §2: scoped by ``release_run_id``; §5: counts only).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from release_worker.eval_models import EvalRun, EvalType
from release_worker.gold_set import GoldCase, GoldSet


@dataclass(frozen=True)
class PipelineOutput:
    """What the current pipeline produced for one gold case: the marketable feature titles it
    surfaced and the claims it flagged as risky/unsupported. Matched leniently (casefold
    substring) so cosmetic wording drift doesn't trip the harness — only real omissions do."""

    surfaced_features: tuple[str, ...] = ()
    flagged_risky_claims: tuple[str, ...] = ()


@dataclass(frozen=True)
class CaseResult:
    """The per-case regression verdict (PRD §17.3)."""

    case_id: str
    missing_features: tuple[str, ...]
    leaked_non_marketable: tuple[str, ...]
    missed_risky_claims: tuple[str, ...]

    @property
    def passed(self) -> bool:
        """A case passes only when nothing is missing, leaked, or missed."""
        return not (
            self.missing_features
            or self.leaked_non_marketable
            or self.missed_risky_claims
        )


@dataclass(frozen=True)
class RegressionReport:
    """The whole-gold-set verdict: one ``CaseResult`` per case plus the pass count."""

    results: tuple[CaseResult, ...]

    @property
    def passed_count(self) -> int:
        return sum(1 for r in self.results if r.passed)

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def all_passed(self) -> bool:
        return self.total > 0 and self.passed_count == self.total


def _matches(needle: str, haystack: Iterable[str]) -> bool:
    """True if ``needle`` appears (casefold substring) in any of ``haystack`` — tolerant of
    wording drift while still catching a genuine omission."""
    key = needle.casefold().strip()
    return any(key in candidate.casefold() for candidate in haystack)


def evaluate_case(case: GoldCase, output: PipelineOutput) -> CaseResult:
    """Score one gold case against what the pipeline produced."""
    missing_features = tuple(
        feature
        for feature in case.expected_marketable_features
        if not _matches(feature, output.surfaced_features)
    )
    # A non-marketable change is "leaked" if the pipeline surfaced it as a feature.
    leaked = tuple(
        change
        for change in case.non_marketable_changes
        if _matches(change, output.surfaced_features)
    )
    missed_risky = tuple(
        claim
        for claim in case.risky_claims
        if not _matches(claim, output.flagged_risky_claims)
    )
    return CaseResult(
        case_id=case.case_id,
        missing_features=missing_features,
        leaked_non_marketable=leaked,
        missed_risky_claims=missed_risky,
    )


def run_regression(
    gold_set: GoldSet, outputs: Mapping[str, PipelineOutput]
) -> RegressionReport:
    """Score every gold case against the pipeline outputs keyed by ``case_id``.

    A case with no provided output is scored against an EMPTY ``PipelineOutput`` — i.e. it
    fails closed (everything missing), so a silently-skipped case can never pass vacuously."""
    results = tuple(
        evaluate_case(case, outputs.get(case.case_id, PipelineOutput()))
        for case in gold_set.cases
    )
    return RegressionReport(results=results)


def regression_eval_run(release_run_id: str, report: RegressionReport) -> EvalRun:
    """Turn a regression report into a persisted ``EvalRun`` (eval_type='regression').

    ``score`` is the pass fraction (0..1); ``findings`` carry the pass/total counts only —
    never the gold text (§5). Run-scoped (§2) so a release's regression result sits alongside
    its metrics + rubric on the dashboard."""
    score = report.passed_count / report.total if report.total else None
    return EvalRun(
        release_run_id=release_run_id,
        eval_type=EvalType.REGRESSION.value,
        score=score,
        findings={"passed": report.passed_count, "total": report.total},
    )
