"""T3 (spec 011) — the model-call telemetry record, its sink port, and the metering step.

Constitution §6 (cost/latency telemetry) + §2 (every row scoped by ``release_run_id``) + §5
(NO PII / NO prompt content in telemetry). One ``ModelCallTelemetry`` row captures what each
Converse call cost the run — node, model id + tier, token counts, latency, USD estimate — and
nothing about *what was said*. The runtime Aurora adapter (``aurora_cost``) persists it; the
in-memory ``RecordingTelemetrySink`` lets the unit gate assert what was recorded.

``meter_call`` is the pure orchestration the runtime ``BedrockModelClient`` runs after every
Converse response: resolve the node's tier (T1), charge + enforce the token budget (T2),
estimate cost (T3), build the row, and hand it to the sink. Keeping it pure (no boto3 / no
I/O) means the routing + budget + cost + redaction-of-telemetry invariants are all unit-tested
here without a live model.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol, runtime_checkable

from release_worker.cost_model import estimate_cost_usd
from release_worker.model_routing import ModelTier, resolve_route, tier_model_id
from release_worker.token_budget import BudgetTracker


@dataclass(frozen=True)
class ModelCallTelemetry:
    """One persisted model-call measurement (PRD §10.7-adjacent / §17).

    Carries ONLY operational metrics + provenance — never the prompt, the evidence, or the
    model output (constitution §5). ``node`` is the routing key (task name), not user text.
    """

    release_run_id: str
    node: str
    model_id: str
    model_tier: str
    input_tokens: int
    output_tokens: int
    latency_ms: int
    cost_usd_estimate: Decimal


@runtime_checkable
class CostTelemetrySink(Protocol):
    """Persist one model-call telemetry row, scoped by ``release_run_id`` (constitution §2)."""

    def record(self, telemetry: ModelCallTelemetry) -> None: ...


class RecordingTelemetrySink:
    """In-memory ``CostTelemetrySink`` fake. Tests inspect ``.records`` to assert the row's
    metrics and that no prompt/PII field exists on the schema at all."""

    def __init__(self) -> None:
        self.records: list[ModelCallTelemetry] = []

    def record(self, telemetry: ModelCallTelemetry) -> None:
        self.records.append(telemetry)


def meter_call(
    *,
    task_name: str,
    release_run_id: str,
    input_tokens: int,
    output_tokens: int,
    latency_ms: int,
    sink: CostTelemetrySink,
    budget: BudgetTracker | None = None,
) -> ModelCallTelemetry:
    """Meter one COMPLETED Converse call: estimate cost, persist telemetry, then enforce budget.

    Order matters, and it is deliberately telemetry-FIRST: this runs *after* the Converse call
    has already executed and been billed by Bedrock, so the cost is sunk regardless of the budget
    verdict. Recording the row before charging the budget guarantees the dashboard (§6) never
    under-reports a call that actually happened — including the very call that trips the cap, the
    moment overrun-visibility matters most. The budget is then charged and may raise
    ``TokenBudgetExceededError`` (a hard run failure); ``UnroutedTaskError`` is raised earlier if
    the task has no configured tier (constitution §6). Returns the recorded row.
    """
    route = resolve_route(task_name)
    tier: ModelTier = route.tier
    model_id = tier_model_id(tier)
    telemetry = ModelCallTelemetry(
        release_run_id=release_run_id,
        node=route.node,
        model_id=model_id,
        model_tier=tier.value,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        latency_ms=latency_ms,
        cost_usd_estimate=estimate_cost_usd(model_id, input_tokens, output_tokens),
    )
    sink.record(telemetry)
    # Charge LAST: the call is already billed, so the row above must persist even on a breach.
    if budget is not None:
        budget.record(route.node, input_tokens, output_tokens)
    return telemetry
