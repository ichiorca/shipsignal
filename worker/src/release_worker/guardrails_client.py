"""T4 (spec 006) — runtime ``GuardrailScanner`` backed by Bedrock Guardrails ApplyGuardrail.

Constitution §1/§3/§5 + aws-bedrock-rules: PII/sensitive-info filtering on generated
artifacts goes through a **published Bedrock Guardrail** — this is the §12.2 safety boundary
that runs on every artifact before Gate #2. It

* calls the ``apply_guardrail`` API of ``bedrock-runtime`` with the published guardrail
  identifier + version from env (no static keys; IAM role credentials from the environment);
* fails closed — any Guardrail ``GUARDRAIL_INTERVENED`` action marks the artifact blocked,
  and the caller (the graph node) never swallows an error, so a Guardrail outage fails the
  run rather than auto-passing (constitution §5/§7);
* never logs the prompt/output (constitution §5 "don't log prompts/outputs").

Imported only by ``__main__`` at runtime (needs boto3), so the unit gate exercises the node
against ``InMemoryGuardrailScanner`` instead.
"""

from __future__ import annotations

import os

import boto3

from release_worker.bedrock_retry import (
    bedrock_client_config,
    call_with_throttle_retry,
)
from release_worker.claim_models import GuardrailVerdict


class BedrockGuardrailScanner:
    """``GuardrailScanner`` over Bedrock Guardrails ``ApplyGuardrail`` (PRD §12.2)."""

    def __init__(
        self,
        client: object,
        guardrail_id: str,
        guardrail_version: str,
    ) -> None:
        self._client = client
        self._guardrail_id = guardrail_id
        self._guardrail_version = guardrail_version

    @classmethod
    def from_env(cls) -> BedrockGuardrailScanner:
        """Build from env. ``BEDROCK_GUARDRAIL_ID``/``_VERSION`` are required — refusing to
        run without a published Guardrail is the safe default (constitution §5)."""
        region = os.environ.get("AWS_REGION", "us-east-1")
        guardrail_id = os.environ.get("BEDROCK_GUARDRAIL_ID")
        guardrail_version = os.environ.get("BEDROCK_GUARDRAIL_VERSION")
        if not guardrail_id or not guardrail_version:
            raise RuntimeError(
                "missing required environment variable: "
                "BEDROCK_GUARDRAIL_ID / BEDROCK_GUARDRAIL_VERSION "
                "(a published Guardrail is mandatory)"
            )
        client = boto3.client(
            "bedrock-runtime", region_name=region, config=bedrock_client_config()
        )
        return cls(client, guardrail_id, guardrail_version)

    def scan(self, text: str) -> GuardrailVerdict:
        """Apply the published Guardrail to one artifact's output text.

        ``source='OUTPUT'`` because we are checking model-generated content (not user input).
        A ``GUARDRAIL_INTERVENED`` action means the content tripped a policy → blocked. The
        intervened assessment categories are summarised (no PII) for the audit trail.
        """
        response = call_with_throttle_retry(
            lambda: self._client.apply_guardrail(  # type: ignore[attr-defined]
                guardrailIdentifier=self._guardrail_id,
                guardrailVersion=self._guardrail_version,
                source="OUTPUT",
                content=[{"text": {"text": text}}],
            ),
            what="Bedrock ApplyGuardrail",
        )
        action = response.get("action", "NONE")
        blocked = action == "GUARDRAIL_INTERVENED"
        categories = _intervened_categories(response.get("assessments", []))
        return GuardrailVerdict(blocked=blocked, action=action, categories=categories)


def _intervened_categories(assessments: object) -> tuple[str, ...]:
    """Summarise which Guardrail policies intervened (names only, never matched values).

    Defensive against the provider payload shape: anything unexpected yields no categories
    rather than raising (the ``blocked`` flag already carries the binding signal)."""
    if not isinstance(assessments, list):
        return ()
    names: list[str] = []
    for assessment in assessments:
        if not isinstance(assessment, dict):
            continue
        for policy_key in (
            "topicPolicy",
            "contentPolicy",
            "sensitiveInformationPolicy",
            "wordPolicy",
            "contextualGroundingPolicy",
        ):
            if policy_key in assessment:
                names.append(policy_key)
    return tuple(names)
