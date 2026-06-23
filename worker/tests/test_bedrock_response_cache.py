"""T5 (spec 023) — the two-tier dedup inside ``BedrockModelClient.generate_json``.

``bedrock_client`` imports boto3, which the lean no-infra unit gate does not install, so this
module is skipped there (``importorskip``) and runs wherever boto3 is present (the dev env and
any job that installs ``worker/requirements.txt``). No AWS call is made — the Converse client
is a fake — so these are still pure-logic tests, just gated on the import.
"""

from __future__ import annotations

import json

import pytest

pytest.importorskip("boto3")

from release_worker.bedrock_client import BedrockModelClient  # noqa: E402
from release_worker.cost_telemetry import RecordingTelemetrySink  # noqa: E402
from release_worker.model_client import InMemoryLlmResponseCache  # noqa: E402

# A routed task so resolve_model() succeeds without env (cluster_features → STANDARD).
_TASK = "cluster_features"


class _FakeConverseClient:
    """Stand-in for the boto3 bedrock-runtime client.

    Counts ``converse`` invocations and returns a fixed, JSON-parseable assistant message in
    the Converse response shape ``generate_json`` reads.
    """

    def __init__(self, payload: dict[str, object]) -> None:
        self._text = json.dumps(payload)
        self.calls = 0

    def converse(self, **_kwargs: object) -> dict[str, object]:
        self.calls += 1
        return {
            "output": {"message": {"content": [{"text": self._text}]}},
            "usage": {"inputTokens": 11, "outputTokens": 22},
        }


def _client(
    fake: _FakeConverseClient,
    *,
    cache: InMemoryLlmResponseCache | None,
    sink: RecordingTelemetrySink,
    release_run_id: str = "run-1",
) -> BedrockModelClient:
    return BedrockModelClient(
        fake,
        "guardrail-id",
        "1",
        release_run_id=release_run_id,
        telemetry_sink=sink,
        cache=cache,
    )


def _gen(client: BedrockModelClient, key: str = "key-1") -> dict[str, object]:
    return client.generate_json(
        _TASK, "system", [{"role": "user", "content": "hi"}], {}, key
    )


def test_durable_cache_dedupes_across_separate_client_instances() -> None:
    # Two clients sharing one L2 store = the initial Actions job + the resume job. The second
    # reuses the paid-for response: zero Converse calls AND zero re-metering (no double bill).
    shared = InMemoryLlmResponseCache()
    fake = _FakeConverseClient({"feature": "x"})

    sink_a = RecordingTelemetrySink()
    first = _gen(_client(fake, cache=shared, sink=sink_a))
    assert first == {"feature": "x"}
    assert fake.calls == 1
    assert len(sink_a.records) == 1  # metered once, on the miss

    sink_b = RecordingTelemetrySink()
    second = _gen(_client(fake, cache=shared, sink=sink_b))
    assert second == {"feature": "x"}
    assert fake.calls == 1  # L2 hit — no new Converse call
    assert sink_b.records == []  # not re-metered — the call was already paid for


def test_without_durable_cache_separate_instances_recompute() -> None:
    # cache=None is the unit/dev path: L1 is process-local, so a fresh instance can't dedupe a
    # prior process's call. This is exactly the gap the durable tier closes.
    fake = _FakeConverseClient({"feature": "x"})
    _gen(_client(fake, cache=None, sink=RecordingTelemetrySink()))
    _gen(_client(fake, cache=None, sink=RecordingTelemetrySink()))
    assert fake.calls == 2


def test_l1_dedupes_within_one_instance_regardless_of_l2() -> None:
    # Repeat key on the SAME client hits the in-process L1 dict — one Converse call — whether or
    # not a durable tier is wired (parity with pre-spec behaviour).
    fake = _FakeConverseClient({"feature": "x"})
    client = _client(fake, cache=None, sink=RecordingTelemetrySink())
    assert _gen(client) == {"feature": "x"}
    assert _gen(client) == {"feature": "x"}
    assert fake.calls == 1


def test_durable_cache_isolates_runs_in_generate_json() -> None:
    # Same idempotency_key under two different runs must each call Converse — no cross-run reuse.
    shared = InMemoryLlmResponseCache()
    fake = _FakeConverseClient({"feature": "x"})
    _gen(
        _client(
            fake, cache=shared, sink=RecordingTelemetrySink(), release_run_id="run-A"
        )
    )
    _gen(
        _client(
            fake, cache=shared, sink=RecordingTelemetrySink(), release_run_id="run-B"
        )
    )
    assert fake.calls == 2
    assert shared.get("run-A", "key-1") == {"feature": "x"}
    assert shared.get("run-B", "key-1") == {"feature": "x"}
