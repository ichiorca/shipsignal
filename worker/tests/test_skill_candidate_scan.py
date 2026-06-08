"""T4/T5 (spec 016) — the §18.2 layer-3 pre-promotion skill-candidate content scan.

Proves a proposed skill body passes through a deterministic + Guardrails scan BEFORE any repo
SKILL.md is written, and that a failing scan blocks promotion (fail closed). Exercised against the
in-memory ``InMemoryGuardrailScanner`` (no Bedrock); the rendered candidate file is what gets
scanned, so a secret, a named §12.3/§18.1 entity, or a Guardrails intervention each refuse the
promotion with ``SkillCandidatePromotionBlockedError`` — and no writer is ever reached.
"""

from __future__ import annotations

import pytest

from release_worker.claim_models import GuardrailVerdict
from release_worker.claim_ports import InMemoryGuardrailScanner
from release_worker.content_policy import (
    CODE_CODENAME,
    CODE_PRIVATE_URL,
    CODE_SECURITY_DETAIL,
    NamedEntityPolicy,
)
from release_worker.skill_learning_models import (
    SkillCandidatePromotionBlockedError,
    SkillRevisionCandidate,
)
from release_worker.skill_learning_nodes import (
    prevent_unsafe_promotion,
    scan_skill_candidate_body,
)


def _candidate(body: str, candidate_id: str = "cand-1") -> SkillRevisionCandidate:
    return SkillRevisionCandidate(
        candidate_id=candidate_id,
        repo="org/repo",
        skill_name="brand-voice",
        skill_path="skills/brand-voice/SKILL.md",
        base_skill_snapshot_id="snap-1",
        proposed_version="1.2.0",
        proposed_body=body,
        proposed_frontmatter={"name": "brand-voice", "version": "1.2.0"},
        proposal_reason="reduce hype",
        miner_type="self_learning",
        supporting_signal_ids=("sig-1",),
        confidence=0.5,
        pattern_hash="abc123",
        old_content_hash="oldhash",
        status="draft",
    )


def _clean_scanner() -> InMemoryGuardrailScanner:
    return InMemoryGuardrailScanner(GuardrailVerdict(blocked=False))


# --- the pure per-candidate scan --------------------------------------------------


def test_clean_candidate_scans_clean() -> None:
    codes = scan_skill_candidate_body(
        _candidate("Write in a clear, plain voice. Avoid overstated claims."),
        _clean_scanner(),
        NamedEntityPolicy(),
    )
    assert codes == ()


def test_named_entity_in_body_is_caught() -> None:
    codes = scan_skill_candidate_body(
        _candidate("Reference http://10.0.0.9/admin when documenting the API."),
        _clean_scanner(),
        NamedEntityPolicy(),
    )
    assert CODE_PRIVATE_URL in codes


def test_secret_in_body_is_caught() -> None:
    codes = scan_skill_candidate_body(
        _candidate("Example: api_key=AKIAIOSFODNN7EXAMPLE in the snippet."),
        _clean_scanner(),
        NamedEntityPolicy(),
    )
    assert "secret_leak" in codes


def test_guardrail_intervention_is_caught() -> None:
    blocking_scanner = InMemoryGuardrailScanner(
        GuardrailVerdict(
            blocked=True, action="GUARDRAIL_INTERVENED", categories=("contentPolicy",)
        )
    )
    codes = scan_skill_candidate_body(
        _candidate("A perfectly normal skill body."),
        blocking_scanner,
        NamedEntityPolicy(),
    )
    assert "guardrail_blocked" in codes


# --- the promotion gate (fail closed) ---------------------------------------------


def test_clean_candidates_pass_through_unchanged() -> None:
    candidates = (
        _candidate("Clean body one."),
        _candidate("Clean body two.", "cand-2"),
    )
    scanner = _clean_scanner()
    result = prevent_unsafe_promotion(candidates, scanner, NamedEntityPolicy())
    assert result == candidates
    # The body that would replace the repo file WAS scanned (no silent bypass).
    assert len(scanner.scanned) == 2


def test_failing_scan_blocks_promotion() -> None:
    bad = _candidate("Today we promote Project Titan internally.")
    policy = NamedEntityPolicy(codenames=("Project Titan",))
    with pytest.raises(SkillCandidatePromotionBlockedError) as exc:
        prevent_unsafe_promotion((bad,), _clean_scanner(), policy)
    # The codes that fired are carried for the audit trail; the message echoes no matched value.
    assert CODE_CODENAME in exc.value.codes
    assert "Project Titan" not in str(exc.value)


def test_one_bad_candidate_blocks_the_whole_promotion() -> None:
    good = _candidate("A clean skill body.", "cand-good")
    bad = _candidate("Mentions a hardcoded password in an example.", "cand-bad")
    with pytest.raises(SkillCandidatePromotionBlockedError) as exc:
        prevent_unsafe_promotion((good, bad), _clean_scanner(), NamedEntityPolicy())
    assert CODE_SECURITY_DETAIL in exc.value.codes


def test_default_policy_still_gates_pattern_checks() -> None:
    # No policy argument → the pattern-based private-URL check still blocks (fail closed).
    bad = _candidate("Point readers at https://dashboard.internal for the demo.")
    with pytest.raises(SkillCandidatePromotionBlockedError):
        prevent_unsafe_promotion((bad,), _clean_scanner())
