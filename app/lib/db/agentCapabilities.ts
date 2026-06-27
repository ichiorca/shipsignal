// agent_capabilities repository: the persisted agent→capability mapping (migration 0035) that the
// Agents page renders and edits. An "agent" is a LangGraph pipeline stage (content-generation, …);
// a "capability" is an artifact type (release_blog, changelog_entry, …). Each row maps an agent to
// one artifact type it is allowed to produce, tagged with its `source` (a seeded code default vs an
// operator override). Sibling of capabilitySkills.ts one level up the chain (agent → capability →
// skill); mirrors the worker's resolution (DB-wins-per-agent over the code default). Server-only
// read/write; all queries parameterised; bodies carry no PII.

import { query, type Queryable } from '@/app/lib/aurora.ts';

/** One (agent, capability) edge as persisted. */
export interface AgentCapability {
  readonly artifact_type: string;
  readonly source: string;
}

/** All capabilities (artifact types) an agent is allowed to produce, alphabetical by type. */
export interface AgentCapabilityMapping {
  readonly agent_id: string;
  readonly capabilities: readonly AgentCapability[];
}

interface AgentCapabilityRow {
  agent_id: string;
  artifact_type: string;
  source: string;
}

/** List the agent→capability mapping grouped by agent (agents alphabetical; within an agent, by
 *  artifact type). Empty when the table is unseeded. */
export async function listAgentCapabilities(): Promise<readonly AgentCapabilityMapping[]> {
  const result = await query<AgentCapabilityRow>(
    `SELECT agent_id, artifact_type, source
       FROM agent_capabilities
      ORDER BY agent_id ASC, artifact_type ASC`,
  );
  const byAgent = new Map<string, AgentCapability[]>();
  for (const row of result.rows) {
    const caps = byAgent.get(row.agent_id) ?? [];
    caps.push({ artifact_type: row.artifact_type, source: row.source });
    byAgent.set(row.agent_id, caps);
  }
  return [...byAgent.entries()].map(([agent_id, capabilities]) => ({ agent_id, capabilities }));
}

/** Add one agent→capability edge as an OPERATOR OVERRIDE (the worker's resolver treats an agent
 *  with any rows as authoritative). Idempotent on (agent_id, artifact_type). */
export async function upsertAgentCapability(
  agentId: string,
  artifactType: string,
  db: Queryable = { query },
): Promise<void> {
  await db.query(
    `INSERT INTO agent_capabilities (agent_id, artifact_type, source)
     VALUES ($1, $2, 'operator-override')
     ON CONFLICT (agent_id, artifact_type) DO UPDATE
        SET source = 'operator-override', updated_at = now()`,
    [agentId, artifactType],
  );
}

/** Remove one agent→capability edge. If an agent ends up with zero rows the worker falls back to
 *  its code default (content-generation → every artifact type), so removal can't strand the stage
 *  with no capabilities. */
export async function deleteAgentCapability(
  agentId: string,
  artifactType: string,
  db: Queryable = { query },
): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM agent_capabilities WHERE agent_id = $1 AND artifact_type = $2`,
    [agentId, artifactType],
  );
  return (result.rowCount ?? 0) > 0;
}
