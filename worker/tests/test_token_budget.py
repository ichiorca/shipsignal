"""T2 (spec 011) — per-node / per-run token-budget enforcement (constitution §6).

Exercises ``BudgetTracker`` the way the runtime client drives it: charging each call's tokens
to a node and the run, accumulating across calls, and RAISING the moment a per-call or per-run
cap is crossed — so an over-budget pipeline fails rather than silently proceeding. Also covers
the env-config and input-validation guards.
"""

from __future__ import annotations

import threading

import pytest

from release_worker.token_budget import (
    BudgetTracker,
    TokenBudget,
    TokenBudgetExceededError,
)


def _tracker(per_call: int, per_run: int) -> BudgetTracker:
    return BudgetTracker(TokenBudget(per_call_max=per_call, per_run_max=per_run))


def test_record_is_thread_safe_under_concurrent_calls() -> None:
    # The content node fans out artifact generation across a ThreadPoolExecutor that shares one
    # tracker; an unsynchronized accumulate would lose increments and let the run silently
    # overshoot its §6 cap. Drive many concurrent record() calls (caps high enough not to trip)
    # and assert NOTHING is lost.
    thread_count = 8
    per_thread = 500
    tracker = _tracker(per_call=1000, per_run=100_000_000)

    def hammer() -> None:
        for _ in range(per_thread):
            tracker.record("generate_", 1, 1)  # 2 tokens per call

    threads = [threading.Thread(target=hammer) for _ in range(thread_count)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    expected = thread_count * per_thread * 2
    assert tracker.total_tokens == expected
    assert tracker.per_node_tokens["generate_"] == expected


def test_records_tokens_per_node_and_run() -> None:
    tracker = _tracker(per_call=1000, per_run=10_000)
    assert tracker.record("cluster_features", 100, 50) == 150
    assert tracker.record("generate_", 200, 100) == 300
    assert tracker.record("generate_", 50, 25) == 75
    assert tracker.total_tokens == 525
    assert tracker.per_node_tokens == {"cluster_features": 150, "generate_": 375}


def test_per_call_cap_raises_before_charging_the_run() -> None:
    tracker = _tracker(per_call=500, per_run=10_000)
    with pytest.raises(TokenBudgetExceededError) as excinfo:
        tracker.record("generate_", 400, 200)  # 600 > 500
    assert excinfo.value.scope == "call:generate_"
    assert excinfo.value.used == 600
    assert excinfo.value.limit == 500
    # The over-cap call did not pollute the run total.
    assert tracker.total_tokens == 0


def test_per_run_cap_raises_when_accumulated_total_exceeds() -> None:
    tracker = _tracker(per_call=1000, per_run=1000)
    tracker.record("a", 400, 100)  # 500, ok
    tracker.record("b", 300, 100)  # 900, ok
    with pytest.raises(TokenBudgetExceededError) as excinfo:
        tracker.record("c", 100, 50)  # run total 1050 > 1000
    assert excinfo.value.scope == "run"
    assert excinfo.value.used == 1050


def test_negative_token_counts_rejected() -> None:
    tracker = _tracker(per_call=1000, per_run=10_000)
    with pytest.raises(ValueError):
        tracker.record("a", -1, 10)


def test_budget_validates_its_caps() -> None:
    with pytest.raises(ValueError):
        TokenBudget(per_call_max=0, per_run_max=10)
    with pytest.raises(ValueError):
        TokenBudget(per_call_max=100, per_run_max=10)  # per_call > per_run


def test_from_env_overrides_then_falls_back_to_defaults() -> None:
    budget = TokenBudget.from_env(
        {"TOKEN_BUDGET_PER_CALL_MAX": "7", "TOKEN_BUDGET_PER_RUN_MAX": "70"}
    )
    assert (budget.per_call_max, budget.per_run_max) == (7, 70)
    default = TokenBudget.from_env({})
    assert default.per_call_max > 0 and default.per_run_max >= default.per_call_max
