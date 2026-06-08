"""learning_signals + skill_revision_candidates + skill_candidate_suppressions

Revision ID: 0008_skill_learning_ledger
Revises: 0007_media_assets
Create Date: 2026-06-08

T1 (spec 009) — the §10.5 self-learning provenance ledger that backs ``skill_learning_graph``
(PRD §5.5). Three tables:

* ``learning_signals`` — reviewer edit diffs, rejected claims, and Gate #1/#2 review notes mined
  from a run, each tagged with the skill snapshots that were active when the artifact was
  produced (so a signal can be attributed to a skill). This is the raw learning evidence.
* ``skill_revision_candidates`` — a *staged* proposed replacement body for a repo SKILL.md, with
  its supporting signals, miner type, confidence, and the Gate #3 review outcome. The promotion
  columns (``promoted_commit_sha``, ``old_content_hash``, ``new_content_hash``, reviewer, ts)
  record the result of an approved replacement and are PRESERVED after the repo file is replaced
  (constitution §9.4.5 / AC2: hashes preserved even after replacement).
* ``skill_candidate_suppressions`` — a cooldown window keyed on a normalized ``pattern_hash`` so a
  near-duplicate of a REJECTED candidate is suppressed and not re-proposed until it expires
  (§9.4.7 / AC3).

§9.2 / AC4 — Aurora is the skills staging + provenance LEDGER, never the canonical registry: the
candidate body lives here only as a *proposal*; the canonical skill stays the repo SKILL.md, which
is replaced (the single repo write) only after an approved Gate #3 decision. Nothing here is the
source of truth for a skill.

P4 (Storage) / constitution §2 (tenancy) + GDPR erasure (constitution §5) — ``learning_signals``
chains to ``release_runs.id`` and CASCADEs, so a run erasure drops its mined signals; ``artifact_id``
SET NULL keeps a signal from dangling against a dropped artifact. ``skill_revision_candidates`` and
``skill_candidate_suppressions`` are repo-level (skills are not run-scoped), so they carry no
release_run FK — they are durable provenance the ledger must keep across runs. ``base_skill_snapshot_id``
and ``rejected_candidate_id`` SET NULL so erasing a snapshot/candidate never destroys the promotion
or suppression history that references it.

Real DDL — not a stub (anti-pattern #1); the downgrade is a clean inverse (drop in FK order).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0008_skill_learning_ledger"
down_revision: str | None = "0007_media_assets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # §10.5 learning_signals — one mined reviewer edit / rejected claim / review note for a run.
    # release_run_id CASCADEs (GDPR run erasure drops the signal); artifact_id SET NULL so a
    # dropped artifact never orphans a signal. signal_type is the kind ('reviewer_edit' |
    # 'rejected_claim' | 'review_note'); diff_json holds the structured before/after for an edit.
    # related_skill_snapshot_ids is the set of skill snapshots active for the artifact, so a
    # signal can be attributed to the skills that shaped the reviewed content (§9.3 step 4).
    op.execute(
        """
        CREATE TABLE learning_signals (
            id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            release_run_id              UUID
                                          REFERENCES release_runs(id) ON DELETE CASCADE,
            artifact_id                 UUID REFERENCES artifacts(id) ON DELETE SET NULL,
            signal_type                 TEXT NOT NULL,
            source_text                 TEXT,
            revised_text                TEXT,
            diff_json                   JSONB,
            reviewer                    TEXT,
            rejection_category          TEXT,
            severity                    TEXT,
            related_skill_snapshot_ids  UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
            created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # "All signals mined for this run" (the miner's input) is the hot read; index by run.
    op.execute(
        "CREATE INDEX ix_learning_signals_release_run_id "
        "ON learning_signals (release_run_id);"
    )

    # §10.5 skill_revision_candidates — a staged proposed replacement body for one repo SKILL.md.
    # base_skill_snapshot_id is the snapshot the proposal is diffed against (SET NULL: keep the
    # candidate even if that snapshot is erased). supporting_signal_ids is the learning evidence the
    # reviewer inspects at Gate #3. status DEFAULTs 'draft'; only a recorded human Gate #3 decision
    # advances it to 'promoted'/'rejected' (constitution §5 — no self-approval). The promotion
    # columns record the result of an APPROVED replacement and are preserved after the repo file is
    # replaced (§9.4.5 / AC2): promoted_commit_sha + old/new content_hash + reviewer + timestamp.
    op.execute(
        """
        CREATE TABLE skill_revision_candidates (
            id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            repo                       TEXT NOT NULL,
            skill_name                 TEXT NOT NULL,
            skill_path                 TEXT NOT NULL,
            base_skill_snapshot_id     UUID
                                         REFERENCES skill_repo_snapshots(id) ON DELETE SET NULL,
            proposed_version           TEXT NOT NULL,
            proposed_body              TEXT NOT NULL,
            proposed_frontmatter_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
            proposal_reason            TEXT NOT NULL,
            miner_type                 TEXT NOT NULL,
            supporting_signal_ids      UUID[] NOT NULL DEFAULT ARRAY[]::uuid[],
            confidence                 NUMERIC,
            pattern_hash               TEXT NOT NULL,
            status                     TEXT NOT NULL DEFAULT 'draft',
            created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
            reviewed_by                TEXT,
            reviewed_at                TIMESTAMPTZ,
            review_notes               TEXT,
            promoted_commit_sha        TEXT,
            old_content_hash           TEXT,
            new_content_hash           TEXT
        );
        """
    )
    # The Gate #3 review screen lists a skill's candidates and the worker loads the pending one;
    # index by (repo, skill_path) and by status for those reads.
    op.execute(
        "CREATE INDEX ix_skill_revision_candidates_skill "
        "ON skill_revision_candidates (repo, skill_path);"
    )
    op.execute(
        "CREATE INDEX ix_skill_revision_candidates_status "
        "ON skill_revision_candidates (status);"
    )

    # §10.5 skill_candidate_suppressions — a cooldown window for a rejected candidate's *pattern*.
    # pattern_hash is a normalized signature of (skill + the clustered signal shape) so a
    # near-duplicate re-proposal hashes to the same value and is suppressed until suppressed_until
    # passes (§9.4.7 / AC3). rejected_candidate_id SET NULL keeps the suppression even if the
    # source candidate row is later erased.
    op.execute(
        """
        CREATE TABLE skill_candidate_suppressions (
            id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            repo                   TEXT NOT NULL,
            skill_name             TEXT NOT NULL,
            pattern_hash           TEXT NOT NULL,
            rejected_candidate_id  UUID
                                     REFERENCES skill_revision_candidates(id) ON DELETE SET NULL,
            suppressed_until       TIMESTAMPTZ NOT NULL,
            reason                 TEXT,
            created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    # The suppression check (drafting) looks up an ACTIVE window by (repo, skill_name, pattern_hash);
    # index that lookup so the miner's per-candidate guard stays cheap.
    op.execute(
        "CREATE INDEX ix_skill_candidate_suppressions_lookup "
        "ON skill_candidate_suppressions (repo, skill_name, pattern_hash);"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_skill_candidate_suppressions_lookup;")
    op.execute("DROP TABLE IF EXISTS skill_candidate_suppressions;")
    op.execute("DROP INDEX IF EXISTS ix_skill_revision_candidates_status;")
    op.execute("DROP INDEX IF EXISTS ix_skill_revision_candidates_skill;")
    op.execute("DROP TABLE IF EXISTS skill_revision_candidates;")
    op.execute("DROP INDEX IF EXISTS ix_learning_signals_release_run_id;")
    op.execute("DROP TABLE IF EXISTS learning_signals;")
