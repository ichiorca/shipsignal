"""T5 (spec 012) — automated Definition-of-Done guard.

constitution §8 ships v1.0 only when the full loop is wired AND no deferred non-goal (§2) has
crept in. This test makes the two structural halves of that contract executable, so a
regression (a dropped gate, a smuggled Step Functions/EventBridge/Lambda/KB client, a second
VCS SDK) fails the gate instead of silently shipping:

1. the loop is complete — four phases in DoD order with exactly the three mandatory gates;
2. no non-goal service/dependency is constructed anywhere in the worker source.

It scans the real ``worker/src`` tree (the runtime), matching only actual client *constructions*
/ imports — not the words where the constitution NAMES the non-goals in prose — so it has teeth
without false-positiving on documentation.
"""

from __future__ import annotations

import re
from pathlib import Path

from release_worker.loop_orchestration import (
    GATE_NUMBER,
    LOOP_SEQUENCE,
    LoopPhase,
)

_WORKER_SRC = Path(__file__).resolve().parents[1] / "src" / "release_worker"

# Non-goal AWS services (§2): adding any is a constitutional change. Matches a boto3/botocore
# client construction for the service, e.g. boto3.client("stepfunctions"). The allowed clients
# are bedrock-runtime and s3 only.
_FORBIDDEN_AWS_CLIENT = re.compile(
    r"""client\(\s*["'](?:stepfunctions|states|events|scheduler|lambda|ecs|"""
    r"""bedrock-agent|bedrock-agent-runtime|bedrock-knowledge|kendra)["']""",
    re.IGNORECASE,
)

# No direct LLM provider SDK and no self-hosted serving (§1: Bedrock Converse is the ONLY path).
_FORBIDDEN_IMPORT = re.compile(
    r"^\s*(?:import|from)\s+(?:anthropic|openai|vllm|transformers|ollama|"
    r"gitlab|atlassian|bitbucket)\b",
    re.MULTILINE,
)


def _worker_sources() -> list[Path]:
    return sorted(_WORKER_SRC.rglob("*.py"))


def test_loop_is_complete_four_phases_three_gates() -> None:
    # The full loop is wired (constitution §8): intel → content → media → skill, with the
    # three mandatory human gates (manifest, artifacts, skill) and no extra/missing gate.
    assert LOOP_SEQUENCE == (
        LoopPhase.RELEASE_INTELLIGENCE,
        LoopPhase.CONTENT_GENERATION,
        LoopPhase.MEDIA_GENERATION,
        LoopPhase.SKILL_LEARNING,
    )
    gate_numbers = sorted(n for n in GATE_NUMBER.values() if n is not None)
    assert gate_numbers == [1, 2, 3]


def test_no_forbidden_aws_service_client_in_worker() -> None:
    offenders = [
        p.name
        for p in _worker_sources()
        if _FORBIDDEN_AWS_CLIENT.search(p.read_text(encoding="utf-8"))
    ]
    assert offenders == [], f"non-goal AWS service client constructed in: {offenders}"


def test_no_direct_provider_sdk_or_second_vcs_import() -> None:
    offenders = [
        p.name
        for p in _worker_sources()
        if _FORBIDDEN_IMPORT.search(p.read_text(encoding="utf-8"))
    ]
    assert offenders == [], f"non-goal import found in: {offenders}"


def test_guard_has_teeth_on_a_forbidden_client_string() -> None:
    # Sanity: the regex actually fires, so a green run means "no offender", not "regex broken".
    assert _FORBIDDEN_AWS_CLIENT.search('boto3.client("stepfunctions")') is not None
    assert _FORBIDDEN_AWS_CLIENT.search('client("s3")') is None
    assert _FORBIDDEN_AWS_CLIENT.search('client("bedrock-runtime")') is None
