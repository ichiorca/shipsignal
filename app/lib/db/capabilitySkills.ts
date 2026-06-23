// capability_skills repository: the persisted capability→skill mapping (migration 0032) that the
// Capabilities page renders. A "capability" is an artifact type (release_blog, changelog_entry, …);
// each row maps it to one skill that grounds its generation, marked `required` and tagged with its
// `source` (a seeded code default vs an operator override). This mirrors the worker's resolution
// (DB-wins-per-type over the `_ARTIFACT_SPECS` code default; peer-parity with hindsight-guild-
// internal's allowed_for). Server-only read; all queries parameterised; bodies carry no PII.

import { query } from '@/app/lib/aurora.ts';

/** One (capability, skill) edge as persisted. */
export interface CapabilitySkill {
  readonly skill_name: string;
  readonly required: boolean;
  readonly source: string;
}

/** All skills mapped to one capability (artifact type), required first then alphabetical. */
export interface CapabilityMapping {
  readonly artifact_type: string;
  readonly skills: readonly CapabilitySkill[];
}

interface CapabilitySkillRow {
  artifact_type: string;
  skill_name: string;
  required: boolean;
  source: string;
}

/** List the capability→skill mapping grouped by artifact type (capabilities alphabetical; within
 *  a capability, required skills first then by name). Empty when the table is unseeded. */
export async function listCapabilitySkills(): Promise<readonly CapabilityMapping[]> {
  const result = await query<CapabilitySkillRow>(
    `SELECT artifact_type, skill_name, required, source
       FROM capability_skills
      ORDER BY artifact_type ASC, required DESC, skill_name ASC`,
  );
  const byType = new Map<string, CapabilitySkill[]>();
  for (const row of result.rows) {
    const skills = byType.get(row.artifact_type) ?? [];
    skills.push({ skill_name: row.skill_name, required: row.required, source: row.source });
    byType.set(row.artifact_type, skills);
  }
  return [...byType.entries()].map(([artifact_type, skills]) => ({ artifact_type, skills }));
}
