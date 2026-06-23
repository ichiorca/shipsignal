// skills repository: typed reads for the skills read API (PRD §14.4) and the Skill-admin screen
// (PRD §13.1). Reads the Aurora `skills` table — the SOURCE OF TRUTH for a skill's active body
// (constitution §2, as amended): one row per skill carrying `current_version` + a `versions{}`
// map. The admin surfaces the active version plus the full version history (skill evolution).
// The repo `SKILL.md` is a derived cache reconciled from this. Bodies are repo-authored skill text
// (no secret/raw evidence); all queries are parameterised.

import { query } from '@/app/lib/aurora.ts';

/** One skill version as the admin screen / detail API renders it (a row of the version history).
 *  Field names preserved from the prior snapshot model for consumer compatibility. */
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

/** A per-skill summary for the admin list: the active version + how many versions exist. */
export interface SkillSummary {
  readonly skill_name: string;
  readonly skill_path: string;
  readonly repo: string;
  readonly active_version: string | null;
  readonly active_commit_sha: string;
  readonly active_content_hash: string;
  readonly snapshot_count: number;
}

/** The full detail for one skill: its active version + the version history (newest first). */
export interface SkillDetail {
  readonly skill_name: string;
  readonly active: SkillSnapshotView | null;
  readonly snapshots: readonly SkillSnapshotView[];
}

/** One entry in the `versions{}` JSONB map (what the worker/seeder write). */
interface VersionEntry {
  body_md?: string;
  content_hash?: string;
  source?: string;
}

interface SkillRow {
  name: string;
  current_version: string;
  versions: Record<string, VersionEntry>;
  status: string;
  updated_at: string | Date;
}

const BODY_EXCERPT_CHARS = 800;

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function skillPath(name: string): string {
  return `skills/${name}/SKILL.md`;
}

/** Map one (version → entry) into the snapshot-shaped view used by the admin UI. */
function versionView(row: SkillRow, version: string, entry: VersionEntry): SkillSnapshotView {
  return {
    id: `${row.name}@${version}`,
    repo: '', // skills are repo-agnostic in the DB store (the SoT); the cache lives at skill_path
    skill_name: row.name,
    skill_path: skillPath(row.name),
    skill_version: version,
    commit_sha: entry.source ?? '', // provenance of the version (e.g. repo-seed / gate3-promotion)
    content_hash: entry.content_hash ?? '',
    body_excerpt: (entry.body_md ?? '').slice(0, BODY_EXCERPT_CHARS),
    is_active: version === row.current_version,
    synced_at: toIso(row.updated_at),
  };
}

/** List active skills with their current version + version count, newest-updated first. */
export async function listSkills(limit = 200): Promise<readonly SkillSummary[]> {
  const result = await query<SkillRow>(
    `SELECT name, current_version, versions, status, updated_at
       FROM skills
      WHERE status = 'active'
      ORDER BY updated_at DESC
      LIMIT $1`,
    [limit],
  );
  return result.rows.map((row) => {
    const current = row.versions?.[row.current_version] ?? {};
    return {
      skill_name: row.name,
      skill_path: skillPath(row.name),
      repo: '',
      active_version: row.current_version,
      active_commit_sha: current.source ?? '',
      active_content_hash: current.content_hash ?? '',
      snapshot_count: Object.keys(row.versions ?? {}).length,
    };
  });
}

/** Fetch one skill's active version + full version history (newest version string first), or
 *  null if no such skill exists. Drives GET /api/skills/{skillName} and the detail panel. */
export async function getSkillByName(skillName: string): Promise<SkillDetail | null> {
  const result = await query<SkillRow>(
    `SELECT name, current_version, versions, status, updated_at FROM skills WHERE name = $1`,
    [skillName],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  const versions = row.versions ?? {};
  const snapshots = Object.keys(versions)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((version) => versionView(row, version, versions[version] ?? {}));
  return {
    skill_name: skillName,
    active: snapshots.find((s) => s.is_active) ?? null,
    snapshots,
  };
}
