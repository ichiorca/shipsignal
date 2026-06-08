// T2 (spec 016) — approved_artifact_snapshots repository: the §18.3 immutable approved-content
// record (migration 0016). P5 (Safety rails) / §18.3: at Gate #2 approval the approved content is
// snapshotted into a tamper-evident record distinct from the mutable artifacts row. This module
// reads the per-artifact audit fields (model/prompt/skill versions, generated_at) the approve
// route's ArtifactWithClaims does not carry, assembles the record via the pure buildApprovedSnapshot
// helper, and inserts it ON CONFLICT (artifact_id) DO NOTHING so the FIRST approved content is
// immutable (a re-approval never overwrites it). All queries are parameterised.

import { query } from '@/app/lib/aurora.ts';
import {
  buildApprovedSnapshot,
  type ApprovalContext,
  type ArtifactAuditFields,
} from '@/app/lib/approvedSnapshot.ts';
import type { ArtifactWithClaims } from '@/app/lib/db/claims.ts';

interface AuditRow {
  model_id: string | null;
  prompt_version: string | null;
  skill_versions_json: unknown;
  created_at: string | Date | null;
}

function asSkillVersions(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function asIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Snapshot one approved artifact's final content into the immutable §18.3 record.
 *  Reads the audit fields off the artifacts row, assembles the record (final content hash, evidence
 *  ids, claim support), and inserts it. Idempotent: ON CONFLICT (artifact_id) DO NOTHING preserves
 *  the first approved content, so calling approve twice never tampers with the recorded snapshot. */
export async function snapshotApprovedArtifact(
  artifact: ArtifactWithClaims,
  approval: ApprovalContext,
): Promise<void> {
  const auditResult = await query<AuditRow>(
    `SELECT model_id, prompt_version, skill_versions_json, created_at
       FROM artifacts WHERE id = $1`,
    [artifact.id],
  );
  const auditRow = auditResult.rows[0];
  const audit: ArtifactAuditFields = {
    model_id: auditRow?.model_id ?? null,
    prompt_version: auditRow?.prompt_version ?? null,
    skill_versions: asSkillVersions(auditRow?.skill_versions_json),
    generated_at: asIso(auditRow?.created_at ?? null),
  };

  const record = buildApprovedSnapshot(artifact, audit, approval);

  await query(
    `INSERT INTO approved_artifact_snapshots
       (artifact_id, release_run_id, approval_id, artifact_type, model_id, prompt_version,
        skill_versions_json, evidence_ids_json, claim_support_json, reviewer, reviewer_decision,
        final_title, final_body_markdown, content_hash, generated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (artifact_id) DO NOTHING`,
    [
      record.artifact_id,
      record.release_run_id,
      record.approval_id,
      record.artifact_type,
      record.model_id,
      record.prompt_version,
      JSON.stringify(record.skill_versions),
      JSON.stringify(record.evidence_ids),
      JSON.stringify(record.claim_support),
      record.reviewer,
      record.reviewer_decision,
      record.final_title,
      record.final_body_markdown,
      record.content_hash,
      record.generated_at,
    ],
  );
}
