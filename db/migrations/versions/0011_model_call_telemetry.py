"""model_call_telemetry table

Revision ID: 0011_model_call_telemetry
Revises: 0010_erasure_audit
Create Date: 2026-06-08

T3 (spec 011) — per-call cost/latency telemetry for the Bedrock model gateway (PRD §2.1
model gateway, §6 cost/latency quality bar, §17 cost metrics). One row per Converse call:
which run, which graph node, which model + tier, the input/output token counts, the call
latency, and the USD cost estimate.

Constitution §2 — every row is scoped by ``release_run_id`` (the tenancy key; no cross-run
bleed). Constitution §5 — this table holds NO prompt, NO evidence, NO model output, NO PII:
only operational metrics + provenance, so cost telemetry is safe to retain and to surface on
the dashboard. ``model_tier`` is the routed tier name (model_routing.ModelTier), recorded so
the cost view and the eval gate can detect an untracked tier change.

A FK to ``release_runs(id)`` with ON DELETE CASCADE ties telemetry to its run and lets the
GDPR erasure sweep (spec 010) drop it with the run. Real DDL — not a stub (anti-pattern #1);
the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0011_model_call_telemetry"
down_revision: str | None = "0010_erasure_audit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # cost_usd_estimate is NUMERIC(12,6): sub-cent precision per call, headroom for a run's
    # total. CHECK guards keep token counts / latency non-negative (defence in depth — the
    # writer already validates). No prompt/output column exists by construction (constitution
    # §5: telemetry carries metrics only).
    op.execute(
        """
        CREATE TABLE model_call_telemetry (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            release_run_id     UUID NOT NULL REFERENCES release_runs(id) ON DELETE CASCADE,
            node_name          TEXT NOT NULL,
            model_id           TEXT NOT NULL,
            model_tier         TEXT NOT NULL,
            input_tokens       INTEGER NOT NULL CHECK (input_tokens >= 0),
            output_tokens      INTEGER NOT NULL CHECK (output_tokens >= 0),
            latency_ms         INTEGER NOT NULL CHECK (latency_ms >= 0),
            cost_usd_estimate  NUMERIC(12, 6) NOT NULL CHECK (cost_usd_estimate >= 0),
            created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # The cost view reads "all telemetry for this run" and aggregates by node/model; index the
    # run id (the scope key) to keep that read cheap.
    op.execute(
        "CREATE INDEX ix_model_call_telemetry_release_run_id "
        "ON model_call_telemetry (release_run_id);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_model_call_telemetry_release_run_id;")
    op.execute("DROP TABLE IF EXISTS model_call_telemetry;")
