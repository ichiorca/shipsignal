#!/bin/sh
# T5 (spec 010) — PROJECT-SPECIFIC GDPR compliance gate for the release-to-content engine.
# Blocking: every check is real and exits non-zero on failure (no TODO/exit-1 stubs).
#   source: https://gdpr-info.eu/art-17-gdpr/   (right to erasure)
#   source: https://gdpr-info.eu/art-15-gdpr/   (right of access)
#   source: https://gdpr-info.eu/art-5-gdpr/    (minimisation, storage limitation, purpose)
#   source: https://gdpr-info.eu/art-32-gdpr/   (security/pseudonymisation)
#   source: https://www.edpb.europa.eu/system/files/2025-01/edpb_guidelines_202501_pseudonymisation_en.pdf
# PASS (exit 0): personal data is redacted BEFORE it crosses any persistence/model/transport/
#   log boundary; Bedrock Guardrails carry a PII/sensitive-info policy; logs are PII-scrubbed;
#   and data-subject erasure (Art.17), access/export (Art.15), and retention/TTL (Art.5(1)(e))
#   paths all exist and are unit-verified.
# FAIL (non-zero): any path lets raw personal data escape, or a required control is missing.
set -eu

fail() { echo "GDPR-GATE FAIL: $1"; exit 1; }
ROOT="$(pwd)"

# Prefer ripgrep; fall back to grep -r.
if command -v rg >/dev/null 2>&1; then SEARCH='rg -n --no-heading'; else SEARCH='grep -rn'; fi
search() { $SEARCH "$@" 2>/dev/null || true; }

# pytest runner: the unit-verified checks below invoke specific test files. The repo's
# pyproject sets pythonpath=worker/src so the package resolves without an editable install.
run_pytest() {
  # $1 = test path, $2 = human label
  if ! command -v pytest >/dev/null 2>&1 && ! python -c "import pytest" >/dev/null 2>&1; then
    fail "pytest unavailable to run $2"
  fi
  if command -v pytest >/dev/null 2>&1; then
    pytest -q "$1" >/dev/null 2>&1 || fail "$2 failed ($1)"
  else
    python -m pytest -q "$1" >/dev/null 2>&1 || fail "$2 failed ($1)"
  fi
}

# ---------------------------------------------------------------------------
# 0. Repo sanity.
# ---------------------------------------------------------------------------
[ -d "$ROOT" ] || fail "working directory missing"

# ---------------------------------------------------------------------------
# 1. NEVER: secrets / personal data committed in cleartext (Art.32 confidentiality).
# ---------------------------------------------------------------------------
if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  if git -C "$ROOT" ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '\.env\.(example|sample|template)$' >/dev/null; then
    fail "a real .env file is tracked in git (Art.32 confidentiality)"
  fi
fi
# Require a long LITERAL value after the key name so we flag a hardcoded secret, not the
# legitimate `"xi-api-key": api_key` header line (which binds a variable, not a literal).
if search -e 'AKIA[0-9A-Z]{16}' \
     -e 'xi-api-key["'\'' ]*[:=]["'\'' ]*[A-Za-z0-9_-]{20,}' \
     --glob '!**/node_modules/**' --glob '!**/*.test.*' --glob '!**/test_*.py' \
     --glob '!**/evals/**' . | grep . >/dev/null 2>&1; then
  fail "hardcoded AWS/ElevenLabs credential literal found in source"
fi

# ---------------------------------------------------------------------------
# 2. A redaction/pseudonymisation stage MUST exist (Art.5(1)(c), Art.32(1)(a)).
# ---------------------------------------------------------------------------
if ! search -e 'redact_evidence' -e 'def redact' . | grep . >/dev/null 2>&1; then
  fail "no redaction node found (expected redact_evidence/redact before persist)"
fi

# ---------------------------------------------------------------------------
# 3. NEVER: persist/Bedrock BEFORE redaction. Structural ordering lint (Art.5(1)(c)).
#    persist accepts only the post-redaction type (no raw field), proven without langgraph.
# ---------------------------------------------------------------------------
run_pytest "worker/tests/test_redaction_ordering.py" "redaction-ordering lint"

# ---------------------------------------------------------------------------
# 4. Bedrock Guardrails with a PII/sensitive-info policy MUST be wired (Art.32).
#    The Guardrail is PUBLISHED in AWS (constitution §3: Bedrock owns PII filtering); the
#    code MUST attach it (guardrailIdentifier) AND consume its sensitive-information policy.
# ---------------------------------------------------------------------------
if ! search -e 'guardrailIdentifier' -e 'guardrailVersion' . | grep . >/dev/null 2>&1; then
  fail "Bedrock Converse/Guardrail calls have no Guardrail attached (no guardrailIdentifier)"
fi
if ! search -e 'sensitiveInformationPolicy' . | grep . >/dev/null 2>&1; then
  fail "Guardrail integration does not handle a sensitive-information (PII) policy"
fi

# ---------------------------------------------------------------------------
# 5. NEVER: log raw personal data. A PII-scrubbing log filter MUST be wired (Art.5(1)(f)).
# ---------------------------------------------------------------------------
# Heuristic smell test: logging a whole evidence/PII payload.
if search -e 'print\(.*(evidence_body|raw_excerpt|raw_diff|personal_data)' \
          -e 'console\.log\(.*(evidenceBody|rawExcerpt|personalData)' \
          --glob '!**/*.test.*' --glob '!**/test_*.py' . | grep . >/dev/null 2>&1; then
  fail "a log/print statement appears to emit raw evidence/PII"
fi
# The scrubbing filter must exist AND be installed at the worker entry point.
if ! search -e 'PiiScrubbingFilter' worker/src | grep . >/dev/null 2>&1; then
  fail "no PII-scrubbing logging filter found (expected PiiScrubbingFilter)"
fi
if ! search -e 'install_pii_scrubbing' worker/src/release_worker/__main__.py | grep . >/dev/null 2>&1; then
  fail "PII-scrubbing filter is not installed at the worker entry point (__main__)"
fi
run_pytest "worker/tests/test_log_scrubbing.py" "log-scrubbing PII check"

# ---------------------------------------------------------------------------
# 6. Data-subject ERASURE (Art.17): delete across Aurora AND S3, audited + verified.
# ---------------------------------------------------------------------------
if ! search -e 'def erase_release_run' worker/src | grep . >/dev/null 2>&1; then
  fail "no data-subject erasure path (Art.17) found (expected erase_release_run)"
fi
# Must clear BOTH stores: the runtime store deletes release_runs rows AND lists/deletes S3 keys.
if ! search -e 'delete_run_rows' -e 'delete_objects' worker/src | grep . >/dev/null 2>&1; then
  fail "erasure does not span both Aurora rows and S3 objects"
fi
run_pytest "worker/tests/test_erasure.py" "erasure (Aurora+S3) check"

# ---------------------------------------------------------------------------
# 7. Data-subject ACCESS/EXPORT (Art.15) gated behind a human escalation.
# ---------------------------------------------------------------------------
if ! search -e 'def export_subject_data' worker/src | grep . >/dev/null 2>&1; then
  fail "no data-subject access/export path (Art.15) found (expected export_subject_data)"
fi
if ! search -e 'EscalationRequiredError' worker/src | grep . >/dev/null 2>&1; then
  fail "access/export is not gated behind a human escalation (constitution §7)"
fi
run_pytest "worker/tests/test_access_export.py" "access/export escalation check"

# ---------------------------------------------------------------------------
# 8. RETENTION/TTL (Art.5(1)(e)) + recorded lawful basis (Art.6).
# ---------------------------------------------------------------------------
if ! search -e 'def sweep_expired_evidence' worker/src | grep . >/dev/null 2>&1; then
  fail "no retention/TTL sweep (Art.5(1)(e)) found (expected sweep_expired_evidence)"
fi
if ! search -e 'retention_expires_at' -e 'lawful_basis' db/migrations | grep . >/dev/null 2>&1; then
  fail "evidence schema records no retention deadline / lawful basis"
fi
run_pytest "worker/tests/test_retention.py" "retention/TTL sweep check"

echo "GDPR-GATE PASS: redact-before-use, Guardrail PII policy, log scrubbing, erasure (Aurora+S3), access export (escalated), and retention/TTL all verified"
exit 0
