#!/usr/bin/env bash
# ShipSignal local bootstrap (bash / WSL / macOS / Linux).
#
# Brings up Postgres (TLS, host:5434) + LocalStack (S3/SNS — free community by default;
# Bedrock too if you configure Pro), creates the S3 buckets, attempts a Bedrock Guardrail
# (Pro only), and applies the Alembic migrations.
#
# Usage:   bash local/bootstrap.sh      (run from the repo root)
# Re-run safe (idempotent).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$SCRIPT_DIR/dev-env"
COMPOSE="$SCRIPT_DIR/docker-compose.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$SCRIPT_DIR/dev-env.sample" "$ENV_FILE"
  echo "Created local/dev-env from the sample."
  echo "Fill in LOCALSTACK_AUTH_TOKEN, GITHUB_*, ELEVENLABS_* then re-run."
  exit 1
fi

# --- Load local/dev-env into this process environment -----------------------------
echo "Loading local/dev-env ..."
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${LOCALSTACK_AUTH_TOKEN:-}" ]]; then
  echo "No LOCALSTACK_AUTH_TOKEN -> community LocalStack (S3 + SNS only)."
  echo "  The dashboard works fully; the worker's Bedrock calls need Pro (docs/local-dev.md)."
fi

# --- Bring up the containers ------------------------------------------------------
echo "Starting containers ..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE" up -d --build

# --- Wait for health --------------------------------------------------------------
wait_healthy() {
  local service="$1" retries="${2:-40}" id status
  echo "Waiting for $service to be healthy ..."
  for ((i = 0; i < retries; i++)); do
    id="$(docker compose -f "$COMPOSE" ps -q "$service" || true)"
    if [[ -n "$id" ]]; then
      status="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || true)"
      if [[ "$status" == "healthy" ]]; then echo "  $service healthy."; return 0; fi
    fi
    sleep 3
  done
  echo "  $service did not become healthy in time" >&2
  exit 1
}
wait_healthy postgres
wait_healthy localstack

awslocal_in() { docker compose -f "$COMPOSE" exec -T localstack awslocal "$@"; }

# --- Create S3 buckets (idempotent) -----------------------------------------------
for bucket in "$EVIDENCE_BUCKET" "$MEDIA_BUCKET"; do
  echo "Ensuring S3 bucket: $bucket"
  awslocal_in s3 mb "s3://$bucket" >/dev/null 2>&1 || echo "  (already exists)"
done

# --- Best-effort Bedrock Guardrail (Pro only — skipped in community S3/SNS mode) --
if [[ -n "${LOCALSTACK_AUTH_TOKEN:-}" && -z "${BEDROCK_GUARDRAIL_ID:-}" ]]; then
  echo "Attempting to create a Bedrock Guardrail in LocalStack ..."
  if out="$(awslocal_in bedrock create-guardrail \
        --name shipsignal-local \
        --blocked-input-messaging blocked \
        --blocked-outputs-messaging blocked \
        --output json 2>/dev/null)"; then
    gid="$(printf '%s' "$out" | python -c 'import sys,json;print(json.load(sys.stdin).get("guardrailId",""))' 2>/dev/null || true)"
    if [[ -n "$gid" ]]; then
      echo "  Guardrail created: $gid"
      echo "  -> set BEDROCK_GUARDRAIL_ID=$gid in local/dev-env"
    fi
  else
    echo "  Guardrail creation not supported by this LocalStack build."
    echo "  See docs/local-dev.md 'Bedrock caveats'."
  fi
fi

# --- Apply Alembic migrations (needs the postgresql+psycopg:// dialect form) -------
echo "Applying Alembic migrations ..."
DATABASE_URL="${DATABASE_URL/postgresql:\/\//postgresql+psycopg://}" python -m alembic upgrade head

# --- Seed the canonical skill library as REFERENCE data (idempotent) --------------
# The repo skills/**/SKILL.md ARE the source of truth (constitution §2); this snapshots them
# into skill_repo_snapshots so the dashboard's Skills page reflects the real library on a fresh
# DB. Reuses the worker's own snapshot logic (no drift). Uses the plain DATABASE_URL from dev-env.
echo "Seeding reference skills (skills/**/SKILL.md -> skill_repo_snapshots) ..."
python scripts/seed_reference_skills.py

cat <<'EOF'

Local stack is up.
  Postgres  : localhost:5434 (TLS, sslmode=require)
  LocalStack: http://localhost:4566

Next:
  1. Start the dashboard:  npm install && npm run dev
  2. Run a worker graph:   see docs/local-dev.md
EOF
