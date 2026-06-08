"""T3/T5 (spec 016) — the named deterministic content checks (§12.3/§18.1, §18.2 layer 2).

Exercises the pure ``scan_named_entities`` + ``load_named_entity_policy`` surface and proves the
checks are wired into ``run_deterministic_policy_checks`` as BLOCKING findings (fail closed), so a
codename / customer name / private URL / internal hostname / security-implementation detail can
never reach Gate #2 approval. The lists are project-configurable, never tenant-hardcoded (AC5), and
no finding ever echoes the matched value (constitution §5).
"""

from __future__ import annotations

import json

from release_worker.claim_models import ArtifactClaim, FindingSeverity, SupportStatus
from release_worker.claim_nodes import run_deterministic_policy_checks
from release_worker.content_models import ArtifactDraft
from release_worker.content_policy import (
    CODE_CODENAME,
    CODE_CUSTOMER_NAME,
    CODE_INTERNAL_HOSTNAME,
    CODE_PRIVATE_URL,
    CODE_SECURITY_DETAIL,
    NamedEntityPolicy,
    load_named_entity_policy,
    scan_named_entities,
)

_RUN_ID = "11111111-1111-4111-8111-111111111111"
_ART_ID = "aaaaaaaa-1111-2222-3333-444444444444"


def _artifact(body: str, title: str = "Release highlights") -> ArtifactDraft:
    return ArtifactDraft(
        artifact_id=_ART_ID,
        release_run_id=_RUN_ID,
        feature_id=None,
        artifact_type="release_blog",
        title=title,
        body_markdown=body,
        status="draft",
        model_id="bedrock-model-x",
        prompt_version="content-gen-v1",
        skill_versions={},
    )


def _supported_claim() -> ArtifactClaim:
    # A clean, grounded claim so the ONLY blocking finding under test is the named-entity one.
    return ArtifactClaim(
        claim_id="claim-0",
        artifact_id=_ART_ID,
        claim_text="Admins can create onboarding checklists.",
        claim_type="capability",
        support_status=SupportStatus.SUPPORTED.value,
        risk_level="low",
        evidence_ids=("ev-1",),
    )


# --- the pure scanner -------------------------------------------------------------


def test_clean_text_fires_no_named_checks() -> None:
    flags = scan_named_entities(
        "Teams can now export their dashboards to PDF.", NamedEntityPolicy()
    )
    assert flags == ()


def test_private_url_and_internal_hostname_fire_on_patterns() -> None:
    # Pattern-based checks run with an EMPTY policy (no tenant config needed).
    flags = scan_named_entities(
        "Hit http://10.1.2.3/admin or the box at billing.internal for details.",
        NamedEntityPolicy(),
    )
    assert CODE_PRIVATE_URL in flags
    assert CODE_INTERNAL_HOSTNAME in flags


def test_security_detail_default_floor_fires() -> None:
    flags = scan_named_entities(
        "The fix removes a hardcoded password from the config.", NamedEntityPolicy()
    )
    assert flags == (CODE_SECURITY_DETAIL,)


def test_codename_and_customer_name_are_configurable_whole_word() -> None:
    policy = NamedEntityPolicy(
        codenames=("Project Titan",), customer_names=("Initech",)
    )
    fired = scan_named_entities("Project Titan shipped for Initech this week.", policy)
    assert CODE_CODENAME in fired
    assert CODE_CUSTOMER_NAME in fired
    # Whole-word: a substring of a configured codename must not false-positive.
    assert (
        scan_named_entities("titanium casing", NamedEntityPolicy(codenames=("Titan",)))
        == ()
    )


def test_empty_policy_does_not_flag_arbitrary_company_names() -> None:
    # Not tenant-hardcoded: with no configured list, ordinary brand text is clean (AC5).
    assert (
        scan_named_entities("We integrate with Acme Corp.", NamedEntityPolicy()) == ()
    )


def test_load_policy_from_json_file_extends_security_floor(tmp_path) -> None:
    config = tmp_path / "policy.json"
    config.write_text(
        json.dumps(
            {
                "codenames": ["Bluebird"],
                "customer_names": ["Globex"],
                "internal_hostnames": ["jenkins-prod-01"],
                "security_terms": ["kill switch"],
            }
        ),
        encoding="utf-8",
    )
    policy = load_named_entity_policy(str(config))
    assert policy.codenames == ("Bluebird",)
    assert policy.customer_names == ("Globex",)
    # The configured security term EXTENDS the default floor (private key is still present).
    assert "kill switch" in policy.security_terms
    assert "private key" in policy.security_terms
    # The configured exact internal host is flagged even without an internal TLD.
    assert CODE_INTERNAL_HOSTNAME in scan_named_entities(
        "deployed via jenkins-prod-01", policy
    )


def test_load_policy_missing_or_malformed_falls_back_to_default(tmp_path) -> None:
    # Missing path → default policy (fail closed: pattern checks still run).
    assert load_named_entity_policy(str(tmp_path / "nope.json")).codenames == ()
    bad = tmp_path / "bad.json"
    bad.write_text("{ not json", encoding="utf-8")
    assert load_named_entity_policy(str(bad)).codenames == ()


# --- wired into pre-review artifact validation (the node) -------------------------


def test_named_check_blocks_artifact_in_deterministic_checks() -> None:
    policy = NamedEntityPolicy(codenames=("Project Titan",))
    findings = run_deterministic_policy_checks(
        (_artifact("Today we ship Project Titan to everyone."),),
        (_supported_claim(),),
        policy,
    )
    codename_findings = [f for f in findings if f.code == CODE_CODENAME]
    assert len(codename_findings) == 1
    finding = codename_findings[0]
    assert finding.severity == FindingSeverity.BLOCKING.value
    # User-safe: the detail names the category, never the matched codename value (§5).
    assert "Project Titan" not in finding.detail
    assert finding.artifact_id == _ART_ID


def test_private_url_blocks_with_default_policy_in_node() -> None:
    # No policy argument → the pattern-based checks still gate (the gate is never empty, AC4).
    findings = run_deterministic_policy_checks(
        (_artifact("Open http://192.168.0.5/console to manage it."),),
        (_supported_claim(),),
    )
    blocking = {
        f.code for f in findings if f.severity == FindingSeverity.BLOCKING.value
    }
    assert CODE_PRIVATE_URL in blocking


def test_clean_artifact_has_no_named_blocking_findings() -> None:
    findings = run_deterministic_policy_checks(
        (_artifact("Teams can export dashboards to PDF now."),),
        (_supported_claim(),),
        NamedEntityPolicy(),
    )
    named_codes = {
        CODE_CODENAME,
        CODE_CUSTOMER_NAME,
        CODE_PRIVATE_URL,
        CODE_INTERNAL_HOSTNAME,
        CODE_SECURITY_DETAIL,
    }
    assert not [f for f in findings if f.code in named_codes]
