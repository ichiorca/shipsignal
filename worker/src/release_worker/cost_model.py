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

# Embedding models bill input tokens only (no output). USD / 1K input tokens, on-demand
# us-east-1 list price. Titan Text Embeddings V2 is the routed default (``BedrockEmbeddingClient``).
_EMBED_RATES: Mapping[str, Decimal] = {
    "amazon.titan-embed-text-v2:0": Decimal("0.00002"),
    "amazon.titan-embed-text-v1": Decimal("0.0001"),
}

# Fallback so an unknown embed model never reports $0 (bills the pricier v1 rate, conservative).
_EMBED_FALLBACK_RATE = _EMBED_RATES["amazon.titan-embed-text-v1"]

_THOUSAND = Decimal(1000)
_CENT_QUANTUM = Decimal("0.000001")  # 6 dp — sub-cent precision for per-call estimates.

# ElevenLabs TTS bills by CHARACTER (credits), not tokens, and the USD/credit rate is
# plan-dependent. This default is a conservative list-ish estimate (USD / 1,000 characters);
# operators set their real plan rate via ``ELEVENLABS_USD_PER_1K_CHARS`` so the §6 dashboard
# reflects actual narration spend rather than treating it as free.
_TTS_DEFAULT_USD_PER_1K_CHARS = Decimal("0.30")


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


def estimate_embedding_cost_usd(model_id: str, input_tokens: int) -> Decimal:
    """Estimate the USD cost of one embedding call (input tokens only), 6 dp.

    Unknown embed model ids bill at the fallback rate so embedding cost is never reported as $0.
    """
    if input_tokens < 0:
        raise ValueError("token counts cannot be negative")
    rate = _EMBED_RATES.get(model_id, _EMBED_FALLBACK_RATE)
    cost = (Decimal(input_tokens) * rate) / _THOUSAND
    return cost.quantize(_CENT_QUANTUM, rounding=ROUND_HALF_UP)


def estimate_tts_cost_usd(
    char_count: int, usd_per_1k_chars: Decimal | None = None
) -> Decimal:
    """Estimate the USD cost of one ElevenLabs TTS call from its character count, 6 dp.

    TTS bills per character; ``usd_per_1k_chars`` is the operator's plan rate (defaults to a
    conservative estimate) so narration spend is visible in the §6 dashboard, never $0.
    """
    if char_count < 0:
        raise ValueError("char count cannot be negative")
    rate = (
        usd_per_1k_chars
        if usd_per_1k_chars is not None
        else _TTS_DEFAULT_USD_PER_1K_CHARS
    )
    cost = (Decimal(char_count) * rate) / _THOUSAND
    return cost.quantize(_CENT_QUANTUM, rounding=ROUND_HALF_UP)
