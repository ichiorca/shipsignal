# ShipSignal local bootstrap (Windows / PowerShell).
#
# Brings up Postgres (TLS, host:5434) + LocalStack (S3/SNS — free community by default;
# Bedrock too if you configure Pro), creates the S3 buckets, attempts a Bedrock Guardrail
# (Pro only), and applies the Alembic migrations.
#
# Usage:   pwsh local/bootstrap.ps1
# Re-run safe (idempotent). Run from the repo root.

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$envFile = Join-Path $PSScriptRoot 'dev-env'
$sample  = Join-Path $PSScriptRoot 'dev-env.sample'

if (-not (Test-Path $envFile)) {
  Copy-Item $sample $envFile
  Write-Host "Created local/dev-env from the sample." -ForegroundColor Yellow
  Write-Host "Fill in LOCALSTACK_AUTH_TOKEN, GITHUB_*, ELEVENLABS_* then re-run." -ForegroundColor Yellow
  exit 1
}

# --- Load local/dev-env into this process environment -----------------------------
Write-Host "Loading local/dev-env ..." -ForegroundColor Cyan
Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if ($line -eq '' -or $line.StartsWith('#')) { return }
  $idx = $line.IndexOf('=')
  if ($idx -lt 1) { return }
  $k = $line.Substring(0, $idx).Trim()
  $v = $line.Substring($idx + 1).Trim()
  Set-Item -Path "Env:$k" -Value $v
}

if (-not $env:LOCALSTACK_AUTH_TOKEN) {
  Write-Host "No LOCALSTACK_AUTH_TOKEN -> community LocalStack (S3 + SNS only)." -ForegroundColor Yellow
  Write-Host "  The dashboard works fully; the worker's Bedrock calls need Pro (docs/local-dev.md)." -ForegroundColor Yellow
}

# --- Bring up the containers ------------------------------------------------------
Write-Host "Starting containers ..." -ForegroundColor Cyan
docker compose --env-file $envFile -f (Join-Path $PSScriptRoot 'docker-compose.yml') up -d --build
if ($LASTEXITCODE -ne 0) { throw "docker compose up failed" }

# --- Wait for health --------------------------------------------------------------
function Wait-Healthy([string]$service, [int]$retries = 40) {
  Write-Host "Waiting for $service to be healthy ..." -ForegroundColor Cyan
  for ($i = 0; $i -lt $retries; $i++) {
    $id = (docker compose -f (Join-Path $PSScriptRoot 'docker-compose.yml') ps -q $service)
    if ($id) {
      $status = (docker inspect --format '{{.State.Health.Status}}' $id 2>$null)
      if ($status -eq 'healthy') { Write-Host "  $service healthy." -ForegroundColor Green; return }
    }
    Start-Sleep -Seconds 3
  }
  throw "$service did not become healthy in time"
}
Wait-Healthy 'postgres'
Wait-Healthy 'localstack'

# --- Helper: run an awslocal command inside the LocalStack container ---------------
function AwsLocal([string[]]$cmdArgs) {
  docker compose -f (Join-Path $PSScriptRoot 'docker-compose.yml') exec -T localstack awslocal @cmdArgs
}

# --- Create S3 buckets (idempotent) -----------------------------------------------
foreach ($bucket in @($env:EVIDENCE_BUCKET, $env:MEDIA_BUCKET)) {
  Write-Host "Ensuring S3 bucket: $bucket" -ForegroundColor Cyan
  try { AwsLocal @('s3', 'mb', "s3://$bucket") | Out-Null } catch { Write-Host "  (already exists)" }
}

# --- Best-effort Bedrock Guardrail (Pro only — skipped in community S3/SNS mode) --
if ($env:LOCALSTACK_AUTH_TOKEN -and -not $env:BEDROCK_GUARDRAIL_ID) {
  Write-Host "Attempting to create a Bedrock Guardrail in LocalStack ..." -ForegroundColor Cyan
  try {
    $out = AwsLocal @(
      'bedrock', 'create-guardrail',
      '--name', 'shipsignal-local',
      '--blocked-input-messaging', 'blocked',
      '--blocked-outputs-messaging', 'blocked',
      '--output', 'json'
    )
    $gid = ($out | ConvertFrom-Json).guardrailId
    if ($gid) {
      Write-Host "  Guardrail created: $gid" -ForegroundColor Green
      Write-Host "  -> set BEDROCK_GUARDRAIL_ID=$gid in local/dev-env" -ForegroundColor Yellow
    }
  } catch {
    Write-Host "  Guardrail creation not supported by this LocalStack build." -ForegroundColor Yellow
    Write-Host "  See docs/local-dev.md 'Bedrock caveats'." -ForegroundColor Yellow
  }
}

# --- Apply Alembic migrations (needs the postgresql+psycopg:// dialect form) -------
Write-Host "Applying Alembic migrations ..." -ForegroundColor Cyan
$alembicUrl = $env:DATABASE_URL -replace '^postgresql://', 'postgresql+psycopg://'
$prevUrl = $env:DATABASE_URL
$env:DATABASE_URL = $alembicUrl
try {
  python -m alembic upgrade head
  if ($LASTEXITCODE -ne 0) { throw "alembic upgrade failed (did you 'pip install -r db/requirements.txt'?)" }
} finally {
  $env:DATABASE_URL = $prevUrl
}

# --- Seed the canonical skill library as REFERENCE data (idempotent) --------------
# The repo skills/**/SKILL.md ARE the source of truth (constitution §2); this snapshots them into
# skill_repo_snapshots so the dashboard's Skills page reflects the real library on a fresh DB.
# Reuses the worker's own snapshot logic (no drift). Uses the plain DATABASE_URL from dev-env.
Write-Host "Seeding reference skills (skills/**/SKILL.md -> skill_repo_snapshots) ..." -ForegroundColor Cyan
python scripts/seed_reference_skills.py
if ($LASTEXITCODE -ne 0) { throw "seed_reference_skills failed" }

Write-Host ""
Write-Host "Local stack is up." -ForegroundColor Green
Write-Host "  Postgres : localhost:5434 (TLS, sslmode=require)"
Write-Host "  LocalStack: http://localhost:4566"
Write-Host ""
Write-Host "Next:" -ForegroundColor Cyan
Write-Host "  1. Load env into your shell:  Get-Content local/dev-env | ... (the bootstrap already did, for this session)"
Write-Host "  2. Start the dashboard:       npm install; npm run dev"
Write-Host "  3. Run a worker graph:        see docs/local-dev.md"
