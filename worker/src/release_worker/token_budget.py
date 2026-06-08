"""T2 (spec 011) — per-node / per-run token-budget enforcement for the model gateway.

Constitution §6 ("Cost/latency: LLM pipeline stays within its token/latency budget eval
gate") + PRD §12.1. A run must not silently blow its token envelope: the runtime
``BedrockModelClient`` reports each Converse call's token usage to a ``BudgetTracker``,
which accumulates per node and per run and RAISES ``TokenBudgetExceededError`` the moment a
cap is crossed — surfacing the overrun as a failure rather than letting the pipeline run on
(AC: "Exceeding the token/latency budget fails ... rather than silently proceeding").

Throttling backoff (the other half of T2) already lives in ``bedrock_client`` — this module
owns only the budget accounting, kept pure (no boto3 / no I/O) so the unit gate drives it
directly.

The default caps below are deliberate, documented numbers (not magic): generous enough for a
normal release run, tight enough that a prompt-injection loop or a runaway retry trips the
gate. Override per-deployment via ``TokenBudget.from_env``.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field

# Documented defaults (constitution §6 budget envelope). Per-call guards a single pathological
# prompt; per-run guards the whole pipeline (clustering + N artifacts + claims + media + skill).
_DEFAULT_PER_CALL_MAX_TOKENS = 60_000
_DEFAULT_PER_RUN_MAX_TOKENS = 1_500_000

_ENV_PER_CALL = "TOKEN_BUDGET_PER_CALL_MAX"
_ENV_PER_RUN = "TOKEN_BUDGET_PER_RUN_MAX"


class TokenBudgetExceededError(RuntimeError):
    """A model call pushed a node or the run over its configured token budget.

    Carries the scope ("call:<node>" or "run") and the offending totals so the failure is
    actionable without exposing any prompt content (constitution §5 — no prompt in errors).
    """

    def __init__(self, scope: str, used: int, limit: int) -> None:
        super().__init__(f"token budget exceeded for {scope}: {used} > {limit}")
        self.scope = scope
        self.used = used
        self.limit = limit


@dataclass(frozen=True)
class TokenBudget:
    """The per-call and per-run token caps for one release run."""

    per_call_max: int = _DEFAULT_PER_CALL_MAX_TOKENS
    per_run_max: int = _DEFAULT_PER_RUN_MAX_TOKENS

    def __post_init__(self) -> None:
        if self.per_call_max <= 0 or self.per_run_max <= 0:
            raise ValueError("token budget caps must be positive")
        if self.per_call_max > self.per_run_max:
            raise ValueError("per_call_max cannot exceed per_run_max")

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> TokenBudget:
        """Build from env overrides, falling back to the documented defaults."""
        source = os.environ if env is None else env
        per_call = source.get(_ENV_PER_CALL)
        per_run = source.get(_ENV_PER_RUN)
        return cls(
            per_call_max=int(per_call) if per_call else _DEFAULT_PER_CALL_MAX_TOKENS,
            per_run_max=int(per_run) if per_run else _DEFAULT_PER_RUN_MAX_TOKENS,
        )


@dataclass
class BudgetTracker:
    """Accumulates token usage for one run and enforces the budget on each call.

    ``record`` is called AFTER a Converse response is read (we know real token counts then);
    it adds the call's tokens, then checks the per-call and per-run caps and raises on breach.
    State is per-run and per-process — one tracker per release run.
    """

    budget: TokenBudget
    total_tokens: int = 0
    per_node_tokens: dict[str, int] = field(default_factory=dict)

    def record(self, node: str, input_tokens: int, output_tokens: int) -> int:
        """Charge ``input+output`` tokens to ``node`` and the run; return the call total.

        Raises ``TokenBudgetExceededError`` if this call exceeds the per-call cap or pushes
        the run over the per-run cap — the caller treats that as a hard failure.
        """
        if input_tokens < 0 or output_tokens < 0:
            raise ValueError("token counts cannot be negative")
        call_total = input_tokens + output_tokens
        if call_total > self.budget.per_call_max:
            raise TokenBudgetExceededError(
                f"call:{node}", call_total, self.budget.per_call_max
            )
        self.per_node_tokens[node] = self.per_node_tokens.get(node, 0) + call_total
        self.total_tokens += call_total
        if self.total_tokens > self.budget.per_run_max:
            raise TokenBudgetExceededError(
                "run", self.total_tokens, self.budget.per_run_max
            )
        return call_total
