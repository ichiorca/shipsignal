"""T4 (spec 023) — pure size-hygiene policy for the durable LLM response cache.

The ``llm_response_cache`` table (migration 0034) is bounded two ways: GDPR run-erasure is
handled by the ``release_run_id`` FK CASCADE (spec 010), and unbounded growth is held back by
this age-based sweep. Keeping the cutoff a pure function (no clock, no DB, no env captured at
import) lets the unit gate assert the window math directly; the runtime sweep lives in the
``aurora_llm_cache`` adapter, driven by the ``llm-cache-sweep`` privacy CLI subcommand.

constitution §6: the cache is a cost/size-hygiene optimization, not a store of record — a
swept row is simply re-derived (and re-billed) on the next call that needs it, so the only
risk of too-short a window is a marginal cache-miss, never data loss.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from datetime import datetime, timedelta

# Default retention window for cached responses. A run's whole lifecycle (collect → gates →
# media → skill) completes well inside this, so 30 days comfortably covers every resume/retry
# of a run while keeping the table small. Overridable via ``LLM_CACHE_TTL_DAYS`` (tracked config).
DEFAULT_LLM_CACHE_TTL_DAYS = 30

_TTL_ENV_VAR = "LLM_CACHE_TTL_DAYS"


def llm_cache_ttl_days(env: Mapping[str, str] | None = None) -> int:
    """Resolve the cache TTL (days) from env, defaulting to ``DEFAULT_LLM_CACHE_TTL_DAYS``.

    Boundary-validated (the value is operator-supplied config): a non-integer or non-positive
    ``LLM_CACHE_TTL_DAYS`` is rejected rather than silently defaulted, so a typo fails loud
    instead of quietly disabling/over-extending the sweep.
    """
    source = os.environ if env is None else env
    raw = source.get(_TTL_ENV_VAR)
    if raw is None or raw == "":
        return DEFAULT_LLM_CACHE_TTL_DAYS
    try:
        days = int(raw)
    except ValueError as err:
        raise ValueError(
            f"{_TTL_ENV_VAR} must be a positive integer (days), got {raw!r}"
        ) from err
    if days <= 0:
        raise ValueError(f"{_TTL_ENV_VAR} must be > 0, got {days}")
    return days


def cache_sweep_cutoff(now: datetime, ttl_days: int) -> datetime:
    """Return the timestamp before which cached rows are due for deletion.

    A row with ``created_at < cutoff`` is past its window. Measured from ``now`` so the caller
    controls the clock (the unit gate passes a fixed instant; the CLI passes ``datetime.now``).
    """
    return now - timedelta(days=ttl_days)
