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

The production entry is ``main`` — invoked as ``python -m release_worker regression
--outputs <file>`` on the runner after a graph/prompt/model change, it scores the change's
pipeline outputs against the checked-in gold set and exits non-zero on ANY drift, so CI can
gate on it (fail-closed, §5).
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from release_worker.eval_models import EvalRun, EvalType
from release_worker.gold_set import GoldCase, GoldSet, load_gold_set


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


class PipelineOutputRecord(BaseModel):
    """One case's pipeline output in the ``--outputs`` JSON. The file is untrusted-shaped
    boundary input (P5: validate at every boundary), so it is parsed through this strict
    model — never consumed as a raw dict — before it reaches the pure scorer."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    surfaced_features: tuple[str, ...] = ()
    flagged_risky_claims: tuple[str, ...] = ()


class PipelineOutputsFile(BaseModel):
    """The whole ``--outputs`` document: pipeline outputs keyed by gold ``case_id``."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    outputs: dict[str, PipelineOutputRecord]


def load_pipeline_outputs(path: Path) -> dict[str, PipelineOutput]:
    """Load + validate the pipeline-outputs JSON (fail-closed on a malformed shape).

    Raises ``ValidationError`` rather than skipping bad entries — a half-readable outputs
    file must fail the harness, not let unmatched cases fail closed and read as drift."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    document = PipelineOutputsFile.model_validate(raw)
    return {
        case_id: PipelineOutput(
            surfaced_features=record.surfaced_features,
            flagged_risky_claims=record.flagged_risky_claims,
        )
        for case_id, record in document.outputs.items()
    }


def main(argv: list[str] | None = None) -> int:
    """T4 (spec 013) — the gold-set regression runner CLI (PRD §17.3).

    Invoked as ``python -m release_worker regression --outputs <file> [--gold-set <file>]``
    on the Actions runner (constitution §1) after a graph/prompt/model change. Scores the
    supplied pipeline outputs against the checked-in gold set and exits 1 on ANY drift so a
    CI job can gate on it. The report prints case ids + drift counts only — never the gold
    text (§5)."""
    parser = argparse.ArgumentParser(prog="release_worker regression")
    parser.add_argument(
        "--outputs",
        required=True,
        help="JSON file of pipeline outputs keyed by gold case_id.",
    )
    parser.add_argument(
        "--gold-set",
        default=None,
        help="Override the checked-in gold-set path (tests/local dry runs).",
    )
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    gold_set = load_gold_set(Path(args.gold_set) if args.gold_set else None)
    outputs = load_pipeline_outputs(Path(args.outputs))
    report = run_regression(gold_set, outputs)
    for result in report.results:
        status = "pass" if result.passed else "FAIL"
        print(
            f"{result.case_id}: {status} "
            f"(missing={len(result.missing_features)}, "
            f"leaked={len(result.leaked_non_marketable)}, "
            f"missed_risky={len(result.missed_risky_claims)})"
        )
    print(f"{report.passed_count}/{report.total} gold case(s) passed")
    return 0 if report.all_passed else 1
