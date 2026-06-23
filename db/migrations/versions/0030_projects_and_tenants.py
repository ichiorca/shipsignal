"""projects + tenants: pre-configured repos with a per-project credential reference

Revision ID: 0030_projects_and_tenants
Revises: 0029_review_perf_indexes
Create Date: 2026-06-17

Operator-approved expansion (constitution §2 tenancy, §4 storage, §5 secret boundary): a customer
can pre-configure a few PROJECTS (each = a repo or repos + a mapped GitHub credential) and reuse
them per run, instead of typing owner/repo ad-hoc every time. Multi-tenant by construction:

  * tenants       — the org/customer boundary. One 'default' row is seeded so existing single-org
                    usage keeps working with zero config; projects scope to a tenant.
  * projects      — a named, tenant-scoped config: default refs + a GitHub credential REFERENCE.
                    ``github_secret_id`` is an AWS Secrets Manager secret name/ARN — NEVER the token
                    itself (constitution §4/§5: no secret in any DB column). NULL → the worker falls
                    back to the ambient GITHUB_TOKEN (backward compatible).
  * project_repos — the repos a project covers (owner/repo), one project → many repos.

``release_runs.project_id`` is added nullable (ON DELETE SET NULL): a run may target a saved project
OR stay ad-hoc (repo typed in the form), so this is additive and breaks nothing. The worker resolves
the per-project token from Secrets Manager at run time via release_run_id → project_id →
github_secret_id.

Real DDL — not a stub; the downgrade is a clean inverse (drop the column, then the tables in
dependency order).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0030_projects_and_tenants"
down_revision: str | None = "0029_review_perf_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # --- tenants: the org/customer boundary --------------------------------------------------
    # id is a human-readable slug. The seeded 'default' tenant lets existing single-org usage work
    # unchanged (every project defaults to it) while leaving room for real multi-tenancy later.
    op.execute(
        """
        CREATE TABLE tenants (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        "INSERT INTO tenants (id, name) VALUES ('default', 'Default') ON CONFLICT DO NOTHING;"
    )

    # --- projects: a tenant-scoped, named repo config + credential REFERENCE -------------------
    # github_secret_id is an AWS Secrets Manager name/ARN (the reference), never the token. NULL =>
    # worker uses the ambient GITHUB_TOKEN. status gates which projects are selectable.
    op.execute(
        """
        CREATE TABLE projects (
            id               TEXT PRIMARY KEY,
            tenant_id        TEXT NOT NULL DEFAULT 'default'
                               REFERENCES tenants(id) ON DELETE CASCADE,
            name             TEXT NOT NULL,
            default_base_ref TEXT NOT NULL DEFAULT '',
            default_head_ref TEXT NOT NULL DEFAULT '',
            github_secret_id TEXT,
            status           TEXT NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active', 'archived')),
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    op.execute("CREATE INDEX ix_projects_tenant_id ON projects (tenant_id);")

    # --- project_repos: the repos a project covers (owner/repo) --------------------------------
    op.execute(
        """
        CREATE TABLE project_repos (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            repo        TEXT NOT NULL,
            UNIQUE (project_id, repo)
        );
        """
    )
    op.execute(
        "CREATE INDEX ix_project_repos_project_id ON project_repos (project_id);"
    )

    # --- release_runs.project_id: optional link to a saved project -----------------------------
    # Nullable + ON DELETE SET NULL: ad-hoc runs (no project) stay valid, and deleting a project
    # never deletes its run history (the run keeps its own repo/refs).
    op.execute(
        "ALTER TABLE release_runs "
        "ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;"
    )
    op.execute("CREATE INDEX ix_release_runs_project_id ON release_runs (project_id);")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_release_runs_project_id;")
    op.execute("ALTER TABLE release_runs DROP COLUMN IF EXISTS project_id;")
    op.execute("DROP TABLE IF EXISTS project_repos;")
    op.execute("DROP TABLE IF EXISTS projects;")
    op.execute("DROP TABLE IF EXISTS tenants;")
