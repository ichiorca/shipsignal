"""eval_runs table

Revision ID: 0012_eval_runs
Revises: 0011_model_call_telemetry
Create Date: 2026-06-08

T1 (spec 013) — the product-evaluation persistence layer (PRD §10.7 eval_runs, §17 metrics +
rubric). One row per recorded evaluation of a run (or a run's artifact): a deterministic
product metric (§17.1), an LLM-as-judge rubric score (§17.2), or a regression-harness result
(§17.3). ``eval_type`` discriminates them — a ``MetricName`` value (e.g. ``evidence_coverage``),
``"rubric"``, or ``"regression"`` — and ``score`` is the single numeric headline; ``rubric_json``
holds per-dimension scores, ``findings_json`` the (PII-free) supporting counts + any human
override.

Constitution §2 — every row is scoped by ``release_run_id`` (the tenancy key; no cross-run
bleed) and optionally an ``artifact_id`` for artifact-level evals. Constitution §5 — this table
holds NO prompt, NO evidence, NO model output, NO PII: only numeric scores + aggregate counts,
so eval telemetry is safe to retain and surface on the dashboard (P6).

FKs to ``release_runs(id)`` and ``artifacts(id)`` both ON DELETE CASCADE so the GDPR erasure
sweep (spec 010) drops a run's evals with the run, and an artifact's evals with the artifact.
Real DDL — not a stub (anti-pattern #1); ``downgrade`` is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0012_eval_runs"
down_revision: str | None = "0011_model_call_telemetry"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # score is NUMERIC (nullable): a rate/ratio (0..1), a mean latency in seconds, or a 1..5
    # rubric mean — null when a metric has no denominator (e.g. no claims yet). rubric_json /
    # findings_json default to '{}' so a metric row (no rubric) and a rubric row (no extra
    # findings) are both valid without nulls. No prompt/output column exists by construction
    # (constitution §5: eval telemetry carries scores + counts only).
    op.execute(
        """
        CREATE TABLE eval_runs (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            release_run_id  UUID NOT NULL REFERENCES release_runs(id) ON DELETE CASCADE,
            artifact_id     UUID REFERENCES artifacts(id) ON DELETE CASCADE,
            eval_type       TEXT NOT NULL,
            score           NUMERIC,
            rubric_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
            findings_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # The eval dashboard reads "all evals for this run" and the read API filters by run +
    # eval_type; index the run id (the scope key) and the (run, type) pair to keep both cheap.
    op.execute(
        "CREATE INDEX ix_eval_runs_release_run_id ON eval_runs (release_run_id);"
    )
    op.execute(
        "CREATE INDEX ix_eval_runs_release_run_id_eval_type "
        "ON eval_runs (release_run_id, eval_type);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_eval_runs_release_run_id_eval_type;")
    op.execute("DROP INDEX IF EXISTS ix_eval_runs_release_run_id;")
    op.execute("DROP TABLE IF EXISTS eval_runs;")
