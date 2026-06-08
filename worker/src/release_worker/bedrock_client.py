"""T2 (spec 004) — runtime ``ModelClient`` backed by the Amazon Bedrock Converse API.

Constitution §1/§3 + aws-bedrock-rules: this is the ONLY model path. It

* calls the **Converse** API (not model-specific ``InvokeModel`` payloads);
* always attaches a **published Guardrail** (``guardrailIdentifier`` + version from env),
  so PII/sensitive-info filtering runs on every generation (constitution §5);
* uses **IAM role credentials** from the ambient environment (no static keys);
* handles ``ThrottlingException`` with **exponential backoff + jitter**;
* enforces **idempotency itself** (synchronous Converse has none): it caches responses by
  the caller-supplied ``idempotency_key`` so a retried clustering call neither re-bills nor
  double-clusters.

Imported only by ``__main__`` at runtime (needs boto3), so the unit gate exercises the
nodes against the in-memory fake instead. Secrets/config (model id, guardrail id/version,
region) are read from env, never hardcoded or logged (constitution §5; we never log the
prompt or the model output).
"""

from __future__ import annotations

import json
import logging
import os
import time

import boto3
from botocore.exceptions import ClientError

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
    """``ModelClient`` over Bedrock Converse with a published Guardrail attached."""

    def __init__(
        self,
        client: object,
        model_id: str,
        guardrail_id: str,
        guardrail_version: str,
    ) -> None:
        self._client = client
        self._model_id = model_id
        self._guardrail_id = guardrail_id
        self._guardrail_version = guardrail_version
        # idempotency_key -> parsed JSON response (process-local dedupe cache).
        self._cache: dict[str, dict[str, object]] = {}

    @classmethod
    def from_env(cls) -> BedrockModelClient:
        """Build from env. ``BEDROCK_GUARDRAIL_ID``/``_VERSION`` are required — refusing
        to run without a Guardrail is the safe default (constitution §5)."""
        region = os.environ.get("AWS_REGION", "us-east-1")
        model_id = os.environ.get(
            "BEDROCK_MODEL_ID", "anthropic.claude-3-5-sonnet-20241022-v2:0"
        )
        guardrail_id = os.environ.get("BEDROCK_GUARDRAIL_ID")
        guardrail_version = os.environ.get("BEDROCK_GUARDRAIL_VERSION")
        if not guardrail_id or not guardrail_version:
            raise RuntimeError(
                "missing required environment variable: "
                "BEDROCK_GUARDRAIL_ID / BEDROCK_GUARDRAIL_VERSION "
                "(a published Guardrail is mandatory)"
            )
        client = boto3.client("bedrock-runtime", region_name=region)
        return cls(client, model_id, guardrail_id, guardrail_version)

    def _converse(self, system: str, messages: list[dict[str, str]]) -> str:
        """One Converse call with the Guardrail attached + throttling backoff.

        Returns the concatenated text of the assistant message. Never logs the prompt or
        the output (constitution §5 "don't log prompts/outputs").
        """
        converse_messages = [
            {"role": m["role"], "content": [{"text": m["content"]}]} for m in messages
        ]
        last_error: ClientError | None = None
        for attempt in range(_MAX_ATTEMPTS):
            try:
                response = self._client.converse(  # type: ignore[attr-defined]
                    modelId=self._model_id,
                    system=[{"text": system}],
                    messages=converse_messages,
                    guardrailConfig={
                        "guardrailIdentifier": self._guardrail_id,
                        "guardrailVersion": self._guardrail_version,
                    },
                )
                blocks = response["output"]["message"]["content"]
                return "".join(b.get("text", "") for b in blocks)
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

        The schema is appended to the system prompt as the output contract; the response
        is parsed as JSON and returned untrusted (the caller re-validates via Pydantic).
        """
        if idempotency_key in self._cache:
            return self._cache[idempotency_key]

        system_with_schema = (
            f"{system}\n\nReturn ONLY a JSON object matching this schema:\n"
            f"{json.dumps(schema)}"
        )
        text = self._converse(system_with_schema, messages)
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as err:
            # Surface a task-scoped error without echoing the (evidence-derived) output.
            raise ValueError(f"Bedrock returned non-JSON for task {task_name}") from err
        if not isinstance(parsed, dict):
            raise ValueError(f"Bedrock returned non-object JSON for task {task_name}")

        self._cache[idempotency_key] = parsed
        return parsed
