"""T2 (spec 004) — the ``ModelClient`` port (PRD §12.1) plus an in-memory fake.

P1 (Substrate) / constitution §3: Bedrock Converse is the *only* model path. The rest
of the worker never imports boto3 or calls Bedrock directly — it depends on this narrow
Protocol so model routing stays replaceable and the unit gate runs without boto3. The
durable Converse implementation (with a published Guardrail attached) lives in the
runtime-only ``bedrock_client`` module imported by ``__main__``.

aws-bedrock-rules: synchronous Converse has no idempotency of its own, so callers pass
an ``idempotency_key`` (a deterministic content hash) and the adapter dedupes on it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class Call:
    """One recorded ``generate_json`` invocation (test introspection)."""

    task_name: str
    system: str
    messages: list[dict[str, str]]
    schema: dict[str, object]
    idempotency_key: str


@runtime_checkable
class ModelClient(Protocol):
    """Generate a JSON object for a task from a system prompt + messages (PRD §12.1).

    Implementations MUST attach a published Bedrock Guardrail (constitution §5) and
    treat the returned dict as untrusted — the caller validates it through a Pydantic
    model before use. ``idempotency_key`` lets the adapter dedupe retried calls, since
    synchronous Converse offers no idempotency itself (aws-bedrock-rules)."""

    def generate_json(
        self,
        task_name: str,
        system: str,
        messages: list[dict[str, str]],
        schema: dict[str, object],
        idempotency_key: str,
    ) -> dict[str, object]: ...


class RecordingModelClient:
    """In-process ``ModelClient`` fake for unit/dev runs.

    Returns a preset response and records every call so tests can assert two things the
    constitution cares about: that the prompt carried only redacted evidence (it inspects
    ``calls[-1].messages``), and that the same ``idempotency_key`` is reused on retry.
    """

    def __init__(self, response: dict[str, object]) -> None:
        self._response = response
        # One Call per generate_json invocation, newest last — tests inspect .messages
        # (only redacted evidence) and .idempotency_key (stable on retry).
        self.calls: list[Call] = []

    def generate_json(
        self,
        task_name: str,
        system: str,
        messages: list[dict[str, str]],
        schema: dict[str, object],
        idempotency_key: str,
    ) -> dict[str, object]:
        self.calls.append(
            Call(
                task_name=task_name,
                system=system,
                messages=messages,
                schema=schema,
                idempotency_key=idempotency_key,
            )
        )
        return self._response
