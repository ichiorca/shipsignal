"""artifacts + skill_repo_snapshots + skill_usage_events

Revision ID: 0005_content_artifacts_and_skill_provenance
Revises: 0004_feature_manifest_and_approvals
Create Date: 2026-06-08

T1 (spec 005) — the first content_generation_graph tables: §10.3 artifacts (drafts
generated from approved features) and the §10.5 skill-provenance pair
skill_repo_snapshots / skill_usage_events. Claims (§10.3 artifact_claims /
claim_evidence_links) are deliberately NOT created here — that is the next slice
(spec 006); this migration carries only what the blog/changelog draft slice writes.

P4 (Storage) / constitution §2 (tenancy): every artifacts and skill_usage_events row is
scoped to a release_runs.id and CASCADEs, so GDPR erasure of a run also erases its
drafts and their skill-usage provenance (constitution §5 — erasure across Aurora). The
artifact ↔ feature link is ON DELETE SET NULL: a blog/changelog is release-level (it may
span features) so feature_id is nullable and an erased feature must not drop the draft.

P5 (Safety rails) — audit trail (§18.3): artifacts.status DEFAULTs to 'draft' and the row
carries model_id, prompt_version, and skill_versions_json so every generated draft records
exactly which model + prompt + skill versions produced it. No column flips a draft to
'approved'; Gate #2 (a later spec) does that through a recorded human decision.

§9.2 — Aurora is the skills *staging/provenance ledger*, never the canonical registry:
skill_repo_snapshots records (repo, skill_path, commit_sha) of the repo SKILL.md that was
loaded, with content_hash for tamper-evidence. UNIQUE(repo, skill_path, commit_sha) makes
re-snapshotting the same commit idempotent (the node upserts). is_active marks the snapshot
that matches the current commit so a run can find the live skill body.

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0005_content_artifacts_and_skill_provenance"
down_revision: str | None = "0004_feature_manifest_and_approvals"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # §10.3 artifacts — one generated draft (blog/changelog here). feature_id is nullable
    # and SET NULL on delete because a release blog is release-level, not tied to a single
    # feature. status DEFAULT 'draft'; model_id/prompt_version/skill_versions_json give the
    # §18.3 audit trail for every draft.
    op.execute(
        """
        CREATE TABLE artifacts (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            release_run_id      UUID NOT NULL
                                  REFERENCES release_runs(id) ON DELETE CASCADE,
            feature_id          UUID
                                  REFERENCES feature_clusters(id) ON DELETE SET NULL,
            artifact_type       TEXT NOT NULL,
            title               TEXT,
            body_markdown       TEXT,
            s3_uri              TEXT,
            status              TEXT NOT NULL DEFAULT 'draft',
            model_id            TEXT,
            prompt_version      TEXT,
            skill_versions_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # The draft-preview page lists a run's artifacts; index the tenancy key to keep it cheap.
    op.execute(
        "CREATE INDEX ix_artifacts_release_run_id ON artifacts (release_run_id);"
    )

    # §10.5 skill_repo_snapshots — the snapshot of a repo SKILL.md at a commit. NOT
    # run-scoped (skills are repo-level), so there is no release_run FK. UNIQUE on
    # (repo, skill_path, commit_sha) makes the snapshot node's upsert idempotent.
    op.execute(
        """
        CREATE TABLE skill_repo_snapshots (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            repo                TEXT NOT NULL,
            skill_name          TEXT NOT NULL,
            skill_path          TEXT NOT NULL,
            skill_version       TEXT,
            commit_sha          TEXT NOT NULL,
            content_hash        TEXT NOT NULL,
            frontmatter_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
            body_excerpt        TEXT,
            is_active           BOOLEAN NOT NULL DEFAULT TRUE,
            synced_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (repo, skill_path, commit_sha)
        );
        """
    )
    # Loading the active skill for a (repo, skill_path) is the hot read; index it.
    op.execute(
        "CREATE INDEX ix_skill_repo_snapshots_active "
        "ON skill_repo_snapshots (repo, skill_path) WHERE is_active;"
    )

    # §10.5 skill_usage_events — which snapshot was loaded by which graph node for which
    # artifact. release_run_id + artifact_id CASCADE (run-scoped provenance erases with the
    # run); skill_snapshot_id SET NULL so erasing a run never deletes the repo-level snapshot
    # it referenced (the snapshot is provenance the §9.2 ledger must preserve).
    op.execute(
        """
        CREATE TABLE skill_usage_events (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            release_run_id      UUID REFERENCES release_runs(id) ON DELETE CASCADE,
            artifact_id         UUID REFERENCES artifacts(id) ON DELETE CASCADE,
            graph_name          TEXT NOT NULL,
            node_name           TEXT NOT NULL,
            skill_snapshot_id   UUID
                                  REFERENCES skill_repo_snapshots(id) ON DELETE SET NULL,
            skill_name          TEXT NOT NULL,
            skill_version       TEXT,
            content_hash        TEXT NOT NULL,
            usage_type          TEXT NOT NULL,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # "Which skills produced this artifact" is the audit read; index by artifact.
    op.execute(
        "CREATE INDEX ix_skill_usage_events_artifact_id "
        "ON skill_usage_events (artifact_id);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_skill_usage_events_artifact_id;")
    op.execute("DROP TABLE IF EXISTS skill_usage_events;")
    op.execute("DROP INDEX IF EXISTS ix_skill_repo_snapshots_active;")
    op.execute("DROP TABLE IF EXISTS skill_repo_snapshots;")
    op.execute("DROP INDEX IF EXISTS ix_artifacts_release_run_id;")
    op.execute("DROP TABLE IF EXISTS artifacts;")
