"""T3 (spec 011) — cost estimation + the metering step that persists telemetry.

Covers the pure cost model (per-1K-token rates, exact decimal, fallback for an unknown model)
and ``meter_call`` — the orchestration the runtime client runs after each Converse response:
resolve the node's tier, enforce the token budget, estimate cost, and record a
``ModelCallTelemetry`` row scoped by ``release_run_id`` that carries metrics ONLY (no prompt,
no PII — constitution §5). Also proves budget breaches abort BEFORE anything is persisted.
"""

from __future__ import annotations

from dataclasses import fields
from decimal import Decimal

import pytest

from release_worker.cost_model import estimate_cost_usd
from release_worker.cost_telemetry import (
    ModelCallTelemetry,
    RecordingTelemetrySink,
    meter_call,
)
from release_worker.token_budget import (
    BudgetTracker,
    TokenBudget,
    TokenBudgetExceededError,
)


def test_cost_estimate_uses_per_model_rates_exactly() -> None:
    # Haiku: 1000 in * 0.00025/1k + 1000 out * 0.00125/1k = 0.00025 + 0.00125 = 0.0015.
    assert estimate_cost_usd("anthropic.claude-3-haiku-20240307-v1:0", 1000, 1000) == (
        Decimal("0.001500")
    )
    # Sonnet: 1000 in * 0.003/1k + 1000 out * 0.015/1k = 0.003 + 0.015 = 0.018.
    assert estimate_cost_usd(
        "anthropic.claude-3-5-sonnet-20241022-v2:0", 1000, 1000
    ) == (Decimal("0.018000"))


def test_unknown_model_bills_fallback_rate_not_zero() -> None:
    cost = estimate_cost_usd("some.unconfigured-model:0", 1000, 1000)
    # Falls back to the Sonnet rate — never silently $0.
    assert cost == Decimal("0.018000")


def test_negative_tokens_rejected() -> None:
    with pytest.raises(ValueError):
        estimate_cost_usd("anthropic.claude-3-haiku-20240307-v1:0", -1, 0)


def test_meter_call_records_a_run_scoped_row_with_resolved_tier_and_cost() -> None:
    sink = RecordingTelemetrySink()
    row = meter_call(
        task_name="extract_claims_release_blog",
        release_run_id="run-123",
        input_tokens=1000,
        output_tokens=1000,
        latency_ms=420,
        sink=sink,
    )
    assert sink.records == [row]
    assert row.release_run_id == "run-123"
    assert row.node == "extract_claims_"  # the routing key, not user text
    assert row.model_tier == "cheap"
    assert row.model_id == "anthropic.claude-3-haiku-20240307-v1:0"
    assert row.latency_ms == 420
    assert row.cost_usd_estimate == Decimal("0.001500")


def test_meter_call_charges_the_budget_and_breach_aborts_before_persist() -> None:
    sink = RecordingTelemetrySink()
    budget = BudgetTracker(TokenBudget(per_call_max=100, per_run_max=1000))
    with pytest.raises(TokenBudgetExceededError):
        meter_call(
            task_name="generate_release_blog",
            release_run_id="run-123",
            input_tokens=200,
            output_tokens=50,
            latency_ms=10,
            sink=sink,
            budget=budget,
        )
    # Budget enforced FIRST: nothing was persisted for the over-budget call.
    assert sink.records == []


def test_telemetry_schema_carries_no_prompt_or_pii_field() -> None:
    # Constitution §5: the row is metrics + provenance only — assert the schema itself.
    names = {f.name for f in fields(ModelCallTelemetry)}
    assert names == {
        "release_run_id",
        "node",
        "model_id",
        "model_tier",
        "input_tokens",
        "output_tokens",
        "latency_ms",
        "cost_usd_estimate",
    }
    for forbidden in ("prompt", "system", "messages", "text", "output", "evidence"):
        assert forbidden not in names
