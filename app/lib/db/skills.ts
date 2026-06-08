// T4 (spec 015) — skill_repo_snapshots repository: typed reads for the skills read API
// (PRD §14.4) and the Skill-admin screen (PRD §13.1). P5 (Safety rails) + constitution
// §9.2: Aurora is the skills *staging/provenance ledger*, never the canonical registry —
// these reads surface the snapshot metadata (version, commit SHA, content hash, a body
// excerpt) of the repo SKILL.md that was loaded, so an admin can see the active repo
// skill plus its Aurora snapshot history. The bodies are repo-authored skill text (no
// secret/raw evidence); all queries are parameterised.

import { query } from '@/app/lib/aurora.ts';

/** One skill_repo_snapshots row as the admin screen / detail API renders it. */
export interface SkillSnapshotView {
  readonly id: string;
  readonly repo: string;
  readonly skill_name: string;
  readonly skill_path: string;
  readonly skill_version: string | null;
  readonly commit_sha: string;
  readonly content_hash: string;
  readonly body_excerpt: string;
  readonly is_active: boolean;
  readonly synced_at: string;
}

/** A per-skill summary for the admin list: the active repo skill plus how many snapshots
 *  Aurora has recorded for it. */
export interface SkillSummary {
  readonly skill_name: string;
  readonly skill_path: string;
  readonly repo: string;
  readonly active_version: string | null;
  readonly active_commit_sha: string;
  readonly active_content_hash: string;
  readonly snapshot_count: number;
}

/** The full detail for one skill: its active snapshot (if any) and the snapshot history. */
export interface SkillDetail {
  readonly skill_name: string;
  readonly active: SkillSnapshotView | null;
  readonly snapshots: readonly SkillSnapshotView[];
}

interface SnapshotRow {
  id: string;
  repo: string;
  skill_name: string;
  skill_path: string;
  skill_version: string | null;
  commit_sha: string;
  content_hash: string;
  body_excerpt: string | null;
  is_active: boolean;
  synced_at: string | Date;
}

interface SummaryRow {
  skill_name: string;
  skill_path: string;
  repo: string;
  active_version: string | null;
  active_commit_sha: string;
  active_content_hash: string;
  snapshot_count: string | number;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapSnapshot(row: SnapshotRow): SkillSnapshotView {
  return {
    id: row.id,
    repo: row.repo,
    skill_name: row.skill_name,
    skill_path: row.skill_path,
    skill_version: row.skill_version,
    commit_sha: row.commit_sha,
    content_hash: row.content_hash,
    body_excerpt: row.body_excerpt ?? '',
    is_active: row.is_active,
    synced_at: toIso(row.synced_at),
  };
}

/** List the active repo skills (one per active snapshot) with their Aurora snapshot
 *  counts, newest-synced first. Drives the Skill-admin list (PRD §13.1). */
export async function listSkills(): Promise<readonly SkillSummary[]> {
  const result = await query<SummaryRow>(
    `SELECT s.skill_name,
            s.skill_path,
            s.repo,
            s.skill_version   AS active_version,
            s.commit_sha      AS active_commit_sha,
            s.content_hash    AS active_content_hash,
            (SELECT count(*) FROM skill_repo_snapshots s2
              WHERE s2.repo = s.repo AND s2.skill_path = s.skill_path) AS snapshot_count
       FROM skill_repo_snapshots s
      WHERE s.is_active
      ORDER BY s.synced_at DESC`,
  );
  return result.rows.map((row) => ({
    skill_name: row.skill_name,
    skill_path: row.skill_path,
    repo: row.repo,
    active_version: row.active_version,
    active_commit_sha: row.active_commit_sha,
    active_content_hash: row.active_content_hash,
    snapshot_count: Number(row.snapshot_count),
  }));
}

const SNAPSHOT_COLUMNS =
  'id, repo, skill_name, skill_path, skill_version, commit_sha, content_hash, ' +
  'body_excerpt, is_active, synced_at';

/** Fetch one skill's active snapshot + full snapshot history, or null if no snapshot for
 *  that name exists. Drives GET /api/skills/{skillName} and the skill detail panel. */
export async function getSkillByName(skillName: string): Promise<SkillDetail | null> {
  const result = await query<SnapshotRow>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM skill_repo_snapshots
      WHERE skill_name = $1
      ORDER BY synced_at DESC`,
    [skillName],
  );
  if (result.rows.length === 0) return null;
  const snapshots = result.rows.map(mapSnapshot);
  return {
    skill_name: skillName,
    active: snapshots.find((s) => s.is_active) ?? null,
    snapshots,
  };
}
