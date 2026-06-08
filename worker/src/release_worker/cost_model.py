"""T3 (spec 011) — deterministic per-call cost estimation for the model gateway.

Constitution §6 (cost/latency budget) + PRD §17 (cost metrics). Bedrock Converse bills by
input/output tokens at a published per-1K-token rate that differs by model. This module turns
the token counts a call reports into a USD estimate, so the telemetry row (T3) and the cost
view (T5) can show real spend per node/model. Pure (no boto3 / no I/O), exact decimal math
(never float dollars) — the unit gate drives it directly.

Rates are USD per 1,000 tokens, on-demand us-east-1 list price at time of writing. They are an
ESTIMATE (your contract/region may differ) — used for budgeting and the dashboard breakdown,
not billing. An unknown model id falls back to the STANDARD-tier rate rather than reporting
``$0``, so a mis-keyed model never hides cost.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal


@dataclass(frozen=True)
class ModelRate:
    """USD per 1,000 input / output tokens for one model id."""

    input_per_1k: Decimal
    output_per_1k: Decimal


# On-demand list price (USD / 1K tokens, us-east-1). Keep in sync with the tier defaults in
# ``model_routing`` — these are the models that config can route to.
_MODEL_RATES: Mapping[str, ModelRate] = {
    "anthropic.claude-3-haiku-20240307-v1:0": ModelRate(
        Decimal("0.00025"), Decimal("0.00125")
    ),
    "anthropic.claude-3-5-sonnet-20241022-v2:0": ModelRate(
        Decimal("0.003"), Decimal("0.015")
    ),
    "anthropic.claude-3-opus-20240229-v1:0": ModelRate(
        Decimal("0.015"), Decimal("0.075")
    ),
}

# Fallback so an unrecognized model id never silently reports $0 (it bills the Sonnet rate,
# the STANDARD-tier default — a conservative over-estimate for the cheap tier).
_FALLBACK_RATE = _MODEL_RATES["anthropic.claude-3-5-sonnet-20241022-v2:0"]

_THOUSAND = Decimal(1000)
_CENT_QUANTUM = Decimal("0.000001")  # 6 dp — sub-cent precision for per-call estimates.


def estimate_cost_usd(model_id: str, input_tokens: int, output_tokens: int) -> Decimal:
    """Estimate the USD cost of one Converse call, quantized to 6 decimal places.

    Unknown model ids bill at the fallback (Sonnet) rate so cost is never under-reported.
    """
    if input_tokens < 0 or output_tokens < 0:
        raise ValueError("token counts cannot be negative")
    rate = _MODEL_RATES.get(model_id, _FALLBACK_RATE)
    cost = (
        Decimal(input_tokens) * rate.input_per_1k
        + Decimal(output_tokens) * rate.output_per_1k
    ) / _THOUSAND
    return cost.quantize(_CENT_QUANTUM, rounding=ROUND_HALF_UP)
