"""T5 (spec 023) — durable LLM-cache port semantics + the size-sweep window math.

Pure unit tests (no boto3/psycopg), so the no-infra unit gate exercises the §2 run-scoping
contract and the sweep policy directly. The L1/L2 wiring inside ``generate_json`` lives in
``test_bedrock_response_cache.py`` (needs boto3 importable); the Aurora adapter is covered in
the integration suite.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from release_worker.llm_cache_maintenance import (
    DEFAULT_LLM_CACHE_TTL_DAYS,
    cache_sweep_cutoff,
    llm_cache_ttl_days,
)
from release_worker.model_client import InMemoryLlmResponseCache

_TASK = "cluster_features"


# --------------------------------------------------------------------------- port fake


def test_inmemory_cache_round_trips_by_pair_key() -> None:
    cache = InMemoryLlmResponseCache()
    assert cache.get("run-1", "k1") is None
    cache.put(
        "run-1",
        "k1",
        task_name=_TASK,
        model_id="m",
        response={"v": 1},
        input_tokens=3,
        output_tokens=4,
    )
    assert cache.get("run-1", "k1") == {"v": 1}


def test_inmemory_cache_is_first_writer_wins() -> None:
    cache = InMemoryLlmResponseCache()
    first = cache.put(
        "run-1",
        "k1",
        task_name=_TASK,
        model_id="m",
        response={"v": "first"},
        input_tokens=0,
        output_tokens=0,
    )
    second = cache.put(
        "run-1",
        "k1",
        task_name=_TASK,
        model_id="m",
        response={"v": "second"},
        input_tokens=0,
        output_tokens=0,
    )
    # put() returns the AUTHORITATIVE stored value — the first writer's — so one key always
    # resolves to one object (the cross-process equivalent of the in-process setdefault).
    assert first == {"v": "first"}
    assert second == {"v": "first"}
    assert cache.get("run-1", "k1") == {"v": "first"}


def test_inmemory_cache_isolates_runs() -> None:
    # constitution §2: identical idempotency_key under two runs must NOT share a response.
    cache = InMemoryLlmResponseCache()
    cache.put(
        "run-A",
        "same-key",
        task_name=_TASK,
        model_id="m",
        response={"run": "A"},
        input_tokens=0,
        output_tokens=0,
    )
    assert cache.get("run-B", "same-key") is None
    assert cache.get("run-A", "same-key") == {"run": "A"}


# ------------------------------------------------------------------ sweep window policy


def test_cache_sweep_cutoff_subtracts_the_window() -> None:
    now = datetime(2026, 6, 23, tzinfo=UTC)
    cutoff = cache_sweep_cutoff(now, 30)
    assert cutoff == datetime(2026, 5, 24, tzinfo=UTC)


def test_ttl_days_defaults_when_unset_or_blank() -> None:
    assert llm_cache_ttl_days({}) == DEFAULT_LLM_CACHE_TTL_DAYS
    assert llm_cache_ttl_days({"LLM_CACHE_TTL_DAYS": ""}) == DEFAULT_LLM_CACHE_TTL_DAYS


def test_ttl_days_reads_a_valid_override() -> None:
    assert llm_cache_ttl_days({"LLM_CACHE_TTL_DAYS": "7"}) == 7


@pytest.mark.parametrize("bad", ["0", "-1", "thirty", "3.5"])
def test_ttl_days_rejects_invalid_values(bad: str) -> None:
    # Operator-supplied config is boundary-validated: a typo fails loud, never silently
    # disables or over-extends the sweep.
    with pytest.raises(ValueError):
        llm_cache_ttl_days({"LLM_CACHE_TTL_DAYS": bad})
