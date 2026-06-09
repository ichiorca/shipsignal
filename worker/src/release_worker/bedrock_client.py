"""T2 (spec 004) / T1-T3 (spec 011) — runtime ``ModelClient`` over Amazon Bedrock Converse.

Constitution §1/§3 + aws-bedrock-rules: this is the ONLY model path. It

* calls the **Converse** API (not model-specific ``InvokeModel`` payloads);
* always attaches a **published Guardrail** (``guardrailIdentifier`` + version from env),
  so PII/sensitive-info filtering runs on every generation (constitution §5);
* uses **IAM role credentials** from the ambient environment (no static keys);
* handles ``ThrottlingException`` with **exponential backoff + jitter** (spec 011 T2);
* enforces **idempotency itself** (synchronous Converse has none): it caches responses by
  the caller-supplied ``idempotency_key`` so a retried clustering call neither re-bills nor
  double-clusters.

Spec 011 adds cost/latency governance, all consulted per call via the pure modules so the
unit gate covers them without boto3:

* T1 — **per-node model-tier routing**: the model id is resolved from ``model_routing`` for
  the call's ``task_name`` instead of a single hardcoded ``modelId``;
* T2 — **token-budget enforcement**: the call's reported token usage is charged to a
  ``BudgetTracker``, which raises on an over-budget node/run;
* T3 — **telemetry**: per-call tokens/latency/model/cost are recorded to a
  ``CostTelemetrySink`` scoped by ``release_run_id`` (no prompt/PII).

Imported only by ``__main__`` at runtime (needs boto3), so the unit gate exercises the
metering logic against ``model_routing`` / ``token_budget`` / ``cost_telemetry`` directly.
Secrets/config (guardrail id/version, region, per-tier model ids, budget caps) are read from
env, never hardcoded or logged (constitution §5; we never log the prompt or the output).
"""

from __future__ import annotations

import json
import logging
import os
import time
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

from release_worker.cost_telemetry import (
    CostTelemetrySink,
    ModelCallTelemetry,
    meter_call,
)
from release_worker.embedding_ports import EMBEDDING_DIMS
from release_worker.model_routing import resolve_model
from release_worker.token_budget import BudgetTracker, TokenBudget

logger = logging.getLogger("release_worker.bedrock")

_MAX_ATTEMPTS = 5
_BASE_BACKOFF_SECONDS = 0.5
_BACKOFF_CAP_SECONDS = 16.0


def _jittered_backoff(attempt: int, rand_fraction: float) -> float:
    """Exponential backoff with full jitter, capped (aws-bedrock-rules).

    ``rand_fraction`` (0..1) is injected so the delay is deterministic under test.
    """
    ceiling = min(_BACKOFF_CAP_SECONDS, _BASE_BACKOFF_SECONDS * (2**attempt))
    return ceiling * rand_fraction


class BedrockModelClient:
    """``ModelClient`` over Bedrock Converse with a published Guardrail, per-node tier
    routing (T1), token-budget enforcement (T2), and cost/latency telemetry (T3)."""

    def __init__(
        self,
        client: object,
        guardrail_id: str,
        guardrail_version: str,
        *,
        release_run_id: str | None = None,
        telemetry_sink: CostTelemetrySink | None = None,
        budget: BudgetTracker | None = None,
    ) -> None:
        self._client = client
        self._guardrail_id = guardrail_id
        self._guardrail_version = guardrail_version
        # Cost governance (spec 011). Wired together as a set: when a run id + sink are
        # present, every call is metered (budget charged, telemetry persisted).
        self._release_run_id = release_run_id
        self._telemetry_sink = telemetry_sink
        self._budget = budget
        # idempotency_key -> parsed JSON response (process-local dedupe cache).
        self._cache: dict[str, dict[str, object]] = {}

    @classmethod
    def from_env(
        cls,
        *,
        release_run_id: str | None = None,
        telemetry_sink: CostTelemetrySink | None = None,
    ) -> BedrockModelClient:
        """Build from env. ``BEDROCK_GUARDRAIL_ID``/``_VERSION`` are required — refusing to
        run without a Guardrail is the safe default (constitution §5). When a
        ``telemetry_sink`` + ``release_run_id`` are supplied, the client meters every call
        against an env-configured token budget (spec 011 T2/T3)."""
        region = os.environ.get("AWS_REGION", "us-east-1")
        guardrail_id = os.environ.get("BEDROCK_GUARDRAIL_ID")
        guardrail_version = os.environ.get("BEDROCK_GUARDRAIL_VERSION")
        if not guardrail_id or not guardrail_version:
            raise RuntimeError(
                "missing required environment variable: "
                "BEDROCK_GUARDRAIL_ID / BEDROCK_GUARDRAIL_VERSION "
                "(a published Guardrail is mandatory)"
            )
        client = boto3.client("bedrock-runtime", region_name=region)
        budget = (
            BudgetTracker(TokenBudget.from_env())
            if telemetry_sink is not None
            else None
        )
        return cls(
            client,
            guardrail_id,
            guardrail_version,
            release_run_id=release_run_id,
            telemetry_sink=telemetry_sink,
            budget=budget,
        )

    def _converse(
        self, model_id: str, system: str, messages: list[dict[str, str]]
    ) -> tuple[str, int, int, int]:
        """One Converse call on ``model_id`` with the Guardrail attached + throttling backoff.

        Returns ``(text, input_tokens, output_tokens, latency_ms)``: the concatenated
        assistant text plus the metrics T2/T3 need. Never logs the prompt or the output
        (constitution §5 "don't log prompts/outputs").
        """
        converse_messages = [
            {"role": m["role"], "content": [{"text": m["content"]}]} for m in messages
        ]
        last_error: ClientError | None = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                started = time.monotonic()
                response = self._client.converse(  # type: ignore[attr-defined]
                    modelId=model_id,
                    system=[{"text": system}],
                    messages=converse_messages,
                    guardrailConfig={
                        "guardrailIdentifier": self._guardrail_id,
                        "guardrailVersion": self._guardrail_version,
                    },
                )
                latency_ms = int((time.monotonic() - started) * 1000)
                blocks = response["output"]["message"]["content"]
                text = "".join(b.get("text", "") for b in blocks)
                usage = response.get("usage", {})
                in_tokens = int(usage.get("inputTokens", 0))
                out_tokens = int(usage.get("outputTokens", 0))
                return text, in_tokens, out_tokens, latency_ms
            except ClientError as err:
                code = err.response.get("Error", {}).get("Code", "")
                if code != "ThrottlingException" or attempt == _MAX_ATTEMPTS - 1:
                    raise
                last_error = err
                # Full jitter; deterministic test override not needed at runtime.
                delay = _jittered_backoff(attempt, 0.5)
                logger.warning("Bedrock throttled; backing off %.2fs", delay)
                time.sleep(delay)
        # Unreachable: the loop either returns or raises, but keep mypy happy.
        raise RuntimeError("Bedrock Converse exhausted retries") from last_error

    def generate_json(
        self,
        task_name: str,
        system: str,
        messages: list[dict[str, str]],
        schema: dict[str, object],
        idempotency_key: str,
    ) -> dict[str, object]:
        """Generate a JSON object for ``task_name`` (PRD §12.1), deduped on the key.

        Routes the model by tier (T1), then on a fresh (non-cached) call charges the token
        budget (T2) and records cost/latency telemetry (T3). The schema is appended to the
        system prompt as the output contract; the response is parsed as JSON and returned
        untrusted (the caller re-validates via Pydantic).
        """
        if idempotency_key in self._cache:
            return self._cache[idempotency_key]

        # T1 — pick the model id from the node's configured tier (raises on an unrouted task).
        _tier, model_id = resolve_model(task_name)

        system_with_schema = (
            f"{system}\n\nReturn ONLY a JSON object matching this schema:\n"
            f"{json.dumps(schema)}"
        )
        text, in_tokens, out_tokens, latency_ms = self._converse(
            model_id, system_with_schema, messages
        )

        # T2/T3 — meter the call: enforce the token budget and persist telemetry (no prompt/
        # PII). Skipped only when the client wasn't wired with a run id + sink.
        if self._telemetry_sink is not None and self._release_run_id is not None:
            meter_call(
                task_name=task_name,
                release_run_id=self._release_run_id,
                input_tokens=in_tokens,
                output_tokens=out_tokens,
                latency_ms=latency_ms,
                sink=self._telemetry_sink,
                budget=self._budget,
            )

        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as err:
            # Surface a task-scoped error without echoing the (evidence-derived) output.
            raise ValueError(f"Bedrock returned non-JSON for task {task_name}") from err
        if not isinstance(parsed, dict):
            raise ValueError(f"Bedrock returned non-object JSON for task {task_name}")

        self._cache[idempotency_key] = parsed
        return parsed


class BedrockEmbeddingClient:
    """``EmbeddingClient`` over a Bedrock text-embedding model (T2, spec 017 / PRD §11).

    Embeddings are a distinct Bedrock modality with no Converse surface, so this uses
    ``invoke_model`` against the configured embedding model (Titan Text Embeddings v2 by
    default) rather than Converse — the "Converse, not InvokeModel" rule (aws-bedrock-rules)
    governs *generation* payloads, which still route through ``BedrockModelClient``. Same
    Bedrock service, same IAM-role credentials (no static keys), same region as the
    generation client; the embedding model id is read from env as config, never hardcoded.

    constitution §5: callers only ever pass ``redacted_excerpt`` text (the seam is
    downstream of the redact node), so no raw PII/secret reaches the embedding model, and we
    never log the embedded text or the vector.
    """

    _DEFAULT_EMBED_MODEL = "amazon.titan-embed-text-v2:0"

    def __init__(
        self,
        client: object,
        model_id: str,
        dims: int = EMBEDDING_DIMS,
        *,
        release_run_id: str | None = None,
        telemetry_sink: CostTelemetrySink | None = None,
    ) -> None:
        self._client = client
        self._model_id = model_id
        self._dims = dims
        # When both are wired, every embed call records a cost/latency telemetry row so
        # embeddings (a real per-row Bedrock cost) are no longer invisible to the §6 dashboard.
        self._release_run_id = release_run_id
        self._telemetry_sink = telemetry_sink

    @classmethod
    def from_env(
        cls,
        *,
        release_run_id: str | None = None,
        telemetry_sink: CostTelemetrySink | None = None,
    ) -> BedrockEmbeddingClient:
        """Build from the ambient IAM-role credentials. ``BEDROCK_EMBED_MODEL_ID`` overrides
        the default embedding model; ``AWS_REGION`` selects the region (default us-east-1).
        A ``release_run_id`` + ``telemetry_sink`` enable per-call cost/latency telemetry."""
        region = os.environ.get("AWS_REGION", "us-east-1")
        model_id = os.environ.get("BEDROCK_EMBED_MODEL_ID", cls._DEFAULT_EMBED_MODEL)
        client = boto3.client("bedrock-runtime", region_name=region)
        return cls(
            client,
            model_id,
            release_run_id=release_run_id,
            telemetry_sink=telemetry_sink,
        )

    def embed(self, text: str) -> list[float]:
        """Return the embedding of one redacted text as an ``EMBEDDING_DIMS``-long vector.

        ``dimensions`` is requested explicitly so the returned vector always matches the
        ``evidence_items.embedding vector(1536)`` column. The response is treated as
        untrusted boundary data: a missing/short/non-numeric vector fails fast rather than
        persisting a malformed embedding."""
        body = json.dumps({"inputText": text, "dimensions": self._dims})
        started = time.monotonic()
        response = self._client.invoke_model(  # type: ignore[attr-defined]
            modelId=self._model_id, body=body
        )
        latency_ms = int((time.monotonic() - started) * 1000)
        payload = json.loads(response["body"].read())
        raw = payload.get("embedding")
        if not isinstance(raw, list) or len(raw) != self._dims:
            raise ValueError(
                f"Bedrock embedding model {self._model_id} returned an unexpected vector"
            )
        self._record_telemetry(payload, latency_ms)
        return [float(component) for component in raw]

    def _record_telemetry(self, payload: dict[str, object], latency_ms: int) -> None:
        """Record the embedding call's cost/latency (constitution §6) — observability only, never
        the embedded text or the vector (§5). Embeddings have no routed tier, so the row is built
        directly: ``node='embed'``, tier ``'embedding'``, input tokens from the Titan response,
        no output tokens. Cost is left at 0 (embedding pricing is not in the generation cost model)."""
        if self._telemetry_sink is None or self._release_run_id is None:
            return
        input_tokens_raw = payload.get("inputTextTokenCount", 0)
        input_tokens = input_tokens_raw if isinstance(input_tokens_raw, int) else 0
        self._telemetry_sink.record(
            ModelCallTelemetry(
                release_run_id=self._release_run_id,
                node="embed",
                model_id=self._model_id,
                model_tier="embedding",
                input_tokens=input_tokens,
                output_tokens=0,
                latency_ms=latency_ms,
                cost_usd_estimate=Decimal("0"),
            )
        )
