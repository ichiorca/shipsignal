#!/bin/sh
# T4 (spec 011) — the §6 COST/LATENCY EVAL GATE. Fails the change when the LLM pipeline would
# exceed its token/latency budget or an untracked model-tier change slips in (constitution §6:
# "Cost/latency: LLM pipeline stays within its token/latency budget eval gate; no untracked
# model-tier upgrades"). Three named categories, each gating at ZERO failures:
#
#   [CRITICAL] tier-routing-tracked   — every model-invoking node routes through the documented
#                                       routing config; no node hardcodes a Bedrock model id;
#                                       the recorded telemetry tier matches the configured tier.
#   [CRITICAL] budget-enforced        — per-call/per-run token budgets are enforced and an
#                                       overrun RAISES (the run fails, it does not proceed).
#   [HIGH]     telemetry-pii-free     — per-call cost telemetry is persisted scoped by
#                                       release_run_id and carries NO prompt/PII column.
#
# Any CRITICAL/HIGH category failing exits non-zero (blocks the change). Mirrors privacy-eval.sh.
# Grounding: constitution §6 (cost/latency budget, no untracked tier), §2 (run-scoped), §5 (no
# PII in telemetry); PRD §2.1 (Bedrock model gateway), §17 (cost metrics).
set -eu

WORKER_SRC="worker/src/release_worker"
# The graph node modules that invoke the model. NONE may hardcode a Bedrock model id — model
# selection MUST go through the routing config (model_routing.py). Space-separated basenames so
# the per-file check below word-splits and greps each one individually (a single quoted
# multi-file arg would make rg treat it as one nonexistent path → a vacuous pass).
NODE_FILES="claim_nodes.py content_nodes.py feature_nodes.py media_nodes.py skill_learning_nodes.py"
FAILURES=0

if command -v rg >/dev/null 2>&1; then SEARCH='rg -n --no-heading'; else SEARCH='grep -rn'; fi
search() { $SEARCH "$@" 2>/dev/null || true; }

_pytest() {
  if command -v pytest >/dev/null 2>&1; then
    pytest -q "$1" >/dev/null 2>&1
  else
    python -m pytest -q "$1" >/dev/null 2>&1
  fi
}

# category SEVERITY NAME ; check "<desc>" <cmd...> ; endcat
_CUR_SEV=""; _CUR_NAME=""; _CUR_OK=1
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

# check helpers (exit 0 = ok).
has() { search -e "$1" "${2:-.}" | grep . >/dev/null 2>&1; }
absent() { ! has "$1" "${2:-.}"; }
runtest() { _pytest "$1"; }

# True when NO node module matches the pattern (each file greped individually; $NODE_FILES is
# intentionally unquoted so the loop word-splits it).
absent_in_nodes() {
  for _f in $NODE_FILES; do
    if has "$1" "$WORKER_SRC/$_f"; then return 1; fi
  done
  return 0
}

# ---------------------------------------------------------------------------
# CRITICAL — tier-routing-tracked
# ---------------------------------------------------------------------------
category CRITICAL tier-routing-tracked
check "routing config exists (per-node tier map)" has 'def resolve_route' "$WORKER_SRC/model_routing.py"
check "the model client picks the model id from the routing config (not a hardcoded modelId)" \
  has 'resolve_model' "$WORKER_SRC/bedrock_client.py"
# No graph node may hardcode a Bedrock model id — model selection MUST go through routing.
# An "anthropic.claude" literal in a node file is an untracked tier choice outside the config.
check "no node hardcodes a Bedrock model id (untracked tier change)" \
  absent_in_nodes 'anthropic\.claude'
check "recorded tier matches the configured tier (replay) + routing unit suite green" \
  runtest worker/tests/test_cost_eval_gate.py
check "per-node routing + fail-closed-on-unrouted suite green" \
  runtest worker/tests/test_model_routing.py
endcat

# ---------------------------------------------------------------------------
# CRITICAL — budget-enforced
# ---------------------------------------------------------------------------
category CRITICAL budget-enforced
check "token-budget tracker exists" has 'class BudgetTracker' "$WORKER_SRC/token_budget.py"
check "overrun surfaces as a failure (raises), never proceeds silently" \
  has 'class TokenBudgetExceededError' "$WORKER_SRC/token_budget.py"
check "the model client charges the budget per call" has 'self._budget' "$WORKER_SRC/bedrock_client.py"
check "throttling backoff retained (aws-bedrock-rules)" has '_jittered_backoff' "$WORKER_SRC/bedrock_client.py"
check "budget enforcement unit suite green" runtest worker/tests/test_token_budget.py
endcat

# ---------------------------------------------------------------------------
# HIGH — telemetry-pii-free
# ---------------------------------------------------------------------------
category HIGH telemetry-pii-free
check "telemetry table is scoped by release_run_id (constitution §2)" \
  has 'release_run_id' db/migrations/versions/0011_model_call_telemetry.py
check "telemetry persistence adapter exists" has 'class AuroraCostTelemetrySink' "$WORKER_SRC/aurora_cost.py"
# The telemetry migration must NOT declare a prompt/output/evidence COLUMN (constitution §5).
# Match a column definition (indented identifier + SQL type), so the docstring's "NO prompt…"
# prose never trips the gate — only a real leaky column does.
check "no prompt/output/evidence column in the telemetry schema" \
  absent '^[[:space:]]+(prompt|prompt_text|body_markdown|model_output|redacted_excerpt|raw_excerpt|message|evidence)[[:space:]]+(TEXT|VARCHAR|JSONB|CHAR)' \
  db/migrations/versions/0011_model_call_telemetry.py
check "telemetry-is-metrics-only + cost-estimate unit suite green" \
  runtest worker/tests/test_cost_telemetry.py
endcat

# ---------------------------------------------------------------------------
# Gate: any CRITICAL/HIGH category failure blocks.
# ---------------------------------------------------------------------------
if [ "$FAILURES" -ne 0 ]; then
  echo "COST-LATENCY FAIL: $FAILURES CRITICAL/HIGH categor(ies) failed"
  exit 1
fi
echo "COST-LATENCY PASS: tier-routing-tracked, budget-enforced, telemetry-pii-free all at zero failures"
exit 0
