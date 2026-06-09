"""Integration: a REAL Bedrock Converse call (LocalStack Pro, or real AWS).

Double-gated: needs RUN_INTEGRATION=1 (collected at all) AND RUN_BEDROCK_INTEGRATION=1
(Bedrock is the flakiest local seam — LocalStack runs models via a backend it spins up on
first call, and real AWS bills per token).

This deliberately uses raw ``converse`` WITHOUT a Guardrail: LocalStack's Bedrock may not
implement ``guardrailConfig`` yet (the app's ``BedrockModelClient`` always attaches one).
The point here is the transport seam — boto3 endpoint routing reaches Bedrock and gets a
non-empty assistant message back. If this passes, the model path is reachable locally; the
guardrail/routing/budget layers are covered by the unit suite against the pure modules.
"""

from __future__ import annotations

import os

import boto3
import pytest


def test_bedrock_converse_returns_text() -> None:
    if os.environ.get("RUN_BEDROCK_INTEGRATION") != "1":
        pytest.skip(
            "set RUN_BEDROCK_INTEGRATION=1 (LocalStack Pro Bedrock or real AWS)"
        )
    model_id = os.environ.get("BEDROCK_MODEL_ID")
    if not model_id:
        pytest.skip("BEDROCK_MODEL_ID not set")

    client = boto3.client(
        "bedrock-runtime",
        endpoint_url=os.environ.get("AWS_ENDPOINT_URL"),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
    )
    response = client.converse(
        modelId=model_id,
        messages=[{"role": "user", "content": [{"text": "Reply with the word ok."}]}],
    )
    blocks = response["output"]["message"]["content"]
    text = "".join(b.get("text", "") for b in blocks)
    assert text.strip() != ""
