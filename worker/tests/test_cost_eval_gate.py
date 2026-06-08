"""T4 (spec 011) — the cost-quality eval gate's runnable core (constitution §6).

The ``evals/graders/cost-latency.sh`` gate runs this. It replays a recorded run's telemetry
fixture through the SAME public surfaces production uses — ``model_routing`` (T1),
``token_budget`` (T2), ``cost_model`` (T3) — and asserts the two failure conditions the spec
names:

* "fails CI if cost/latency exceeds budget" — the run's accumulated tokens stay within the
  documented ``TokenBudget``; an over-budget run is proven to RAISE.
* "or an untracked tier change is detected" — every fixture row's recorded ``model_tier`` +
  ``model_id`` must match what the routing config resolves for that node; a drifted row fails.

It also re-asserts the §5 invariant that telemetry carries no prompt/PII. Pure stdlib + the
worker's own modules, so the gate needs only pytest (no DB, no AWS).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from release_worker.cost_model import estimate_cost_usd
from release_worker.model_routing import resolve_route, tier_model_id
from release_worker.token_budget import (
    BudgetTracker,
    TokenBudget,
    TokenBudgetExceededError,
)

_FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "evals"
    / "fixtures"
    / "cost-latency"
    / "sample-run-telemetry.json"
)

# Forbidden keys: a telemetry row must never carry prompt/evidence/output text (constitution §5).
_FORBIDDEN_KEYS = frozenset(
    {"prompt", "system", "messages", "text", "output", "evidence", "redacted_excerpt"}
)


def _load_calls() -> list[dict[str, object]]:
    data = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    calls = data["calls"]
    assert isinstance(calls, list) and calls, "fixture must contain recorded calls"
    return calls


def test_recorded_run_stays_within_token_budget() -> None:
    # Replay the run through the documented budget — it must NOT exceed (cost/latency gate).
    tracker = BudgetTracker(TokenBudget.from_env({}))
    for call in _load_calls():
        tracker.record(
            str(call["node"]), int(call["input_tokens"]), int(call["output_tokens"])
        )
    assert tracker.total_tokens <= TokenBudget.from_env({}).per_run_max


def test_each_recorded_call_matches_the_routing_config() -> None:
    # Untracked-tier-change detection: the recorded tier + model id for each node must equal
    # what the routing config resolves. A code-side tier change without a config update (or a
    # telemetry row from a drifted model) fails here.
    for call in _load_calls():
        route = resolve_route(str(call["node"]))
        assert str(call["model_tier"]) == route.tier.value, (
            f"{call['node']}: recorded tier {call['model_tier']} != configured "
            f"{route.tier.value} (untracked tier change)"
        )
        assert str(call["model_id"]) == tier_model_id(route.tier), (
            f"{call['node']}: recorded model id disagrees with the routed tier's model"
        )


def test_recorded_calls_carry_no_prompt_or_pii() -> None:
    for call in _load_calls():
        leaked = _FORBIDDEN_KEYS & set(call.keys())
        assert not leaked, f"telemetry row leaked prompt/PII keys: {sorted(leaked)}"


def test_an_over_budget_run_is_rejected() -> None:
    # Prove the gate's teeth: a run that exceeds the per-run cap RAISES (does not pass silently).
    tracker = BudgetTracker(TokenBudget(per_call_max=50_000, per_run_max=100_000))
    with pytest.raises(TokenBudgetExceededError):
        for _ in range(10):
            tracker.record(
                "generate_release_blog", 9_000, 4_000
            )  # 13k * 10 = 130k > 100k


def test_recorded_cost_is_estimable_and_nonzero() -> None:
    # Every call yields a concrete USD estimate (the dashboard breakdown depends on it).
    total = sum(
        estimate_cost_usd(
            str(c["model_id"]), int(c["input_tokens"]), int(c["output_tokens"])
        )
        for c in _load_calls()
    )
    assert total > 0
