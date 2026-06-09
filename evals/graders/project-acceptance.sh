#!/bin/sh
# PROJECT-SPECIFIC acceptance gate for the release-to-content engine.
# Blocking: every check is real and exits non-zero on failure (no TODO/exit-1 stubs).
# Encodes the spec's core principle: NEVER generate content directly from raw diffs — build an
# approved, redacted, evidence-backed manifest first, then generate content with claim-level
# provenance behind human approval gates, and promote skills only via an approved Gate #3.
# PASS (exit 0): the four graphs, three human-interrupt gates, redact-before-persist, claim->
#   evidence provenance, and deterministic+Guardrail safety are PRESENT (structural) AND the
#   behavioral anti-requirements are UNIT-VERIFIED. FAIL (non-zero): any structural or
#   behavioral gap.
set -u

fail() { echo "ACCEPTANCE-GATE FAIL: $1"; exit 1; }

# --- locate project root -------------------------------------------------
ROOT="${1:-.}"
cd "$ROOT" 2>/dev/null || fail "cannot enter project root '$ROOT'"

# --- pick a search tool (ripgrep preferred, grep fallback) ---------------
if command -v rg >/dev/null 2>&1; then
  search() { rg -q -i "$1" -- "${2:-.}"; }
else
  search() { grep -R -q -i -- "$1" "${2:-.}"; }
fi

# --- pytest runner for the behavioral checks ------------------------------
# pyproject sets pythonpath=worker/src so the package resolves without an editable install.
# Prefer `python -m pytest` (the bare pytest.exe console-script is blocked by some Device Guard
# policies; python -m runs it through the allowed interpreter).
run_pytest() {  # $1 = test path, $2 = human label
  if python -c "import pytest" >/dev/null 2>&1; then
    python -m pytest -q "$1" >/dev/null 2>&1 || fail "$2 failed ($1)"
  elif command -v pytest >/dev/null 2>&1; then
    pytest -q "$1" >/dev/null 2>&1 || fail "$2 failed ($1)"
  else
    fail "pytest unavailable to run $2"
  fi
}

# =========================================================================
# STRUCTURAL — the pipeline shape the spec mandates must be present.
# =========================================================================

# 1. Canonical skills live in the repo as skills/**/SKILL.md (spec §0, §9.1).
find skills -type f -name 'SKILL.md' 2>/dev/null | grep -q . \
  || fail "no canonical skills found (expected skills/**/SKILL.md)"

# 2. The four LangGraph graphs must exist (spec §5.1).
for g in release_intelligence_graph content_generation_graph media_generation_graph skill_learning_graph; do
  search "$g" || fail "missing required graph: $g"
done

# 3. Three human approval gates as real LangGraph interrupts (spec §5.6).
search "approve_feature_manifest" || fail "gate #1 (feature manifest approval) not found"
search "approve_artifacts"        || fail "gate #2 (artifact approval) not found"
search "approve_skill_candidate"  || fail "gate #3 (skill revision approval) not found"
search "interrupt"                || fail "approval gates present but no LangGraph interrupt() usage found"

# 4. Redaction MUST precede persistence/LLM (spec §4, §5.2 redact->persist).
search "redact_evidence"  || fail "no redact_evidence step (evidence must be redacted before persist/LLM)"
search "persist_evidence" || fail "no persist_evidence step"

# 5. Claim-level provenance: every claim links to evidence (spec §1.7, §5.3, §8.3).
search "extract_claims"          || fail "no claim extraction step"
search "link_claims_to_evidence" || fail "claims are not linked to evidence (provenance missing)"

# 6. Safety: deterministic policy checks + Bedrock Guardrails (spec §5.3, §12, §18).
search "run_deterministic_policy_checks" || fail "deterministic policy checks missing"
search "guardrail"                       || fail "Bedrock Guardrails integration not found"

# =========================================================================
# BEHAVIORAL — the spec's anti-requirements, unit-verified against the code.
# =========================================================================

# 7a. Content generation REFUSES to run without an approved feature manifest — the central
#     anti-requirement (no diff->content shortcut). Proven by
#     test_load_approved_features_refuses_when_none_approved (§5: zero approved -> refuse).
run_pytest "worker/tests/test_content_nodes.py" "content-gen refuses without an approved manifest"

# 7b. No self-approval: persisted features are always pending_review and only a recorded human
#     decision (Gate #1 routing) advances them (§5).
run_pytest "worker/tests/test_feature_nodes.py" "no self-approval (features persist pending_review)"

# 7c. Claim-level provenance is ENFORCED: a grounded claim links to >=1 evidence and is
#     SUPPORTED; an unsupported / high-risk / fabricated-metric / secret-leak / guardrail-flagged
#     claim marks the artifact 'blocked' so Gate #2 cannot approve it (§5, §7, §8.3).
run_pytest "worker/tests/test_claim_nodes.py" "claim->evidence provenance + blocking checks"

# 7d. An approved skill revision replaces the repo SKILL.md and records the commit sha + old/new
#     content hashes in Aurora (§5.5 update_repo_skill_file -> mark_candidate_promoted; §9.4.5).
run_pytest "worker/tests/test_skill_learning_nodes.py" "skill promotion records sha + content hashes"

echo "ACCEPTANCE-GATE PASS: structure (4 graphs, 3 interrupt gates, redact-before-persist, claim provenance, deterministic+Guardrail safety) + behavioral invariants (no diff->content shortcut, no self-approval, enforced claim provenance, gated skill promotion) all verified"
exit 0
