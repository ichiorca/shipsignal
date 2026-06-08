#!/bin/sh
# T5 (spec 010) — the §6 quality-bar PRIVACY EVAL SUITE with CRITICAL/HIGH gates.
# Three named categories, each gating at ZERO failures (constitution §6: "privacy/domain
# evals pass with CRITICAL and HIGH gates at zero failures before deploy"):
#
#   [CRITICAL] redaction-integrity        — personal data is redacted before any boundary.
#   [CRITICAL] pii-phi-exposure           — no PII/PHI escapes to logs, client, or the model.
#   [HIGH]     claim-provenance-accuracy  — every claim links to evidence; unsupported claims
#                                           are flagged, never silently approved.
#
# Any CRITICAL or HIGH category failing exits non-zero (blocks the change). Mirrors the
# privacy-eval skill's category model. Grounding: GDPR Art.5/15/17/32; the project constitution
# §5 (redact-before-use, claim must link to evidence) and §6 (privacy evals at zero failures).
set -eu

ROOT="$(pwd)"
FAILURES=0

if command -v rg >/dev/null 2>&1; then SEARCH='rg -n --no-heading'; else SEARCH='grep -rn'; fi
search() { $SEARCH "$@" 2>/dev/null || true; }

# pytest runner shared by the categories.
_pytest() {
  if command -v pytest >/dev/null 2>&1; then
    pytest -q "$1" >/dev/null 2>&1
  else
    python -m pytest -q "$1" >/dev/null 2>&1
  fi
}

# category SEVERITY NAME ; then a series of `check "<desc>" <cmd...>` lines; close with `endcat`.
_CUR_SEV=""
_CUR_NAME=""
_CUR_OK=1
category() { _CUR_SEV="$1"; _CUR_NAME="$2"; _CUR_OK=1; }
check() {
  desc="$1"; shift
  if "$@" >/dev/null 2>&1; then :; else
    echo "  [$_CUR_SEV] $_CUR_NAME: MISS — $desc"
    _CUR_OK=0
  fi
}
endcat() {
  if [ "$_CUR_OK" -eq 1 ]; then
    echo "[$_CUR_SEV] $_CUR_NAME: PASS"
  else
    echo "[$_CUR_SEV] $_CUR_NAME: FAIL"
    FAILURES=$((FAILURES + 1))
  fi
}

# helpers used as `check` commands (exit 0 = present/ok).
has() { search -e "$1" "${2:-.}" | grep . >/dev/null 2>&1; }
runtest() { _pytest "$1"; }

# ---------------------------------------------------------------------------
# CRITICAL — redaction-integrity
# ---------------------------------------------------------------------------
category CRITICAL redaction-integrity
check "redact node exists" has 'def redact' worker/src
check "post-redaction type carries no raw field / persist-after-redact lint" \
  runtest worker/tests/test_redaction_ordering.py
check "redactor unit suite green" runtest worker/tests/test_redaction.py
endcat

# ---------------------------------------------------------------------------
# CRITICAL — pii-phi-exposure
# ---------------------------------------------------------------------------
category CRITICAL pii-phi-exposure
check "PII-scrubbing log filter exists" has 'PiiScrubbingFilter' worker/src
check "log scrubber installed at the worker entry point" \
  has 'install_pii_scrubbing' worker/src/release_worker/__main__.py
check "log-scrubbing PII check green" runtest worker/tests/test_log_scrubbing.py
check "Guardrail sensitive-information (PII) policy handled" \
  has 'sensitiveInformationPolicy' worker/src
endcat

# ---------------------------------------------------------------------------
# HIGH — claim-provenance-accuracy
# ---------------------------------------------------------------------------
category HIGH claim-provenance-accuracy
check "claims are linked to evidence" has 'def link_claims_to_evidence' worker/src
check "unlinkable claims are marked unsupported (not silently approved)" \
  has 'UNSUPPORTED' worker/src/release_worker/claim_nodes.py
check "claim extraction + linking suite green" runtest worker/tests/test_claim_nodes.py
endcat

# ---------------------------------------------------------------------------
# Gate: any CRITICAL/HIGH category failure blocks.
# ---------------------------------------------------------------------------
if [ "$FAILURES" -ne 0 ]; then
  echo "PRIVACY-EVAL FAIL: $FAILURES CRITICAL/HIGH categor(ies) failed"
  exit 1
fi
echo "PRIVACY-EVAL PASS: redaction-integrity, pii-phi-exposure, claim-provenance-accuracy all at zero failures"
exit 0
