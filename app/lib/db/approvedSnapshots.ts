// T2 (spec 016) — approved_artifact_snapshots repository: the §18.3 immutable approved-content
// record (migration 0016). P5 (Safety rails) / §18.3: at Gate #2 approval the approved content is
// snapshotted into a tamper-evident record distinct from the mutable artifacts row. This module
// reads the per-artifact audit fields (model/prompt/skill versions, generated_at) the approve
// route's ArtifactWithClaims does not carry, assembles the record via the pure buildApprovedSnapshot
// helper, and inserts it ON CONFLICT (artifact_id) DO NOTHING so the FIRST approved content is
// immutable (a re-approval never overwrites it). All queries are parameterised.
//
// T1 (spec 019) — also the READ side for the export/distribution surfaces (§18.1: the snapshot is
// the publishable truth). The view SELECT deliberately omits the `reviewer` column, so no export
// or outbound-webhook shape can ever carry the reviewer's name (data minimization).

import { query, type Queryable } from '@/app/lib/aurora.ts';
import {
  buildApprovedSnapshot,
  type ApprovalContext,
  type ArtifactAuditFields,
  type ClaimSupportEntry,
} from '@/app/lib/approvedSnapshot.ts';
import type { ApprovedSnapshotView } from '@/app/lib/artifactExport.ts';
import type { ArtifactWithClaims } from '@/app/lib/db/claims.ts';
import { isUuid } from '@/app/lib/uuid.ts';

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
  db: Queryable = { query },
): Promise<void> {
  const auditResult = await db.query<AuditRow>(
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

  await db.query(
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

// ---------------------------------------------------------------------------
// T1 (spec 019) — read side: the approved snapshot as the export/distribution
// surfaces consume it. `reviewer` is intentionally NOT in the column list.
// ---------------------------------------------------------------------------

interface SnapshotViewRow {
  artifact_id: string;
  release_run_id: string;
  approval_id: string | null;
  artifact_type: string;
  model_id: string | null;
  prompt_version: string | null;
  skill_versions_json: unknown;
  evidence_ids_json: unknown;
  claim_support_json: unknown;
  reviewer_decision: string;
  final_title: string | null;
  final_body_markdown: string;
  content_hash: string;
  generated_at: string | Date | null;
  approved_at: string | Date | null;
}

const SNAPSHOT_VIEW_COLUMNS =
  'artifact_id, release_run_id, approval_id, artifact_type, model_id, prompt_version, ' +
  'skill_versions_json, evidence_ids_json, claim_support_json, reviewer_decision, ' +
  'final_title, final_body_markdown, content_hash, generated_at, approved_at';

function asEvidenceIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function asClaimSupport(value: unknown): readonly ClaimSupportEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: ClaimSupportEntry[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (
      typeof record['claim_id'] === 'string' &&
      typeof record['support_status'] === 'string' &&
      typeof record['risk_level'] === 'string'
    ) {
      entries.push({
        claim_id: record['claim_id'],
        support_status: record['support_status'],
        risk_level: record['risk_level'],
      });
    }
  }
  return entries;
}

function toSnapshotView(row: SnapshotViewRow): ApprovedSnapshotView {
  return {
    artifact_id: row.artifact_id,
    release_run_id: row.release_run_id,
    approval_id: row.approval_id,
    artifact_type: row.artifact_type,
    model_id: row.model_id,
    prompt_version: row.prompt_version,
    skill_versions: asSkillVersions(row.skill_versions_json),
    evidence_ids: asEvidenceIds(row.evidence_ids_json),
    claim_support: asClaimSupport(row.claim_support_json),
    reviewer_decision: row.reviewer_decision,
    final_title: row.final_title,
    final_body_markdown: row.final_body_markdown,
    content_hash: row.content_hash,
    generated_at: asIso(row.generated_at),
    approved_at: asIso(row.approved_at),
  };
}

/** Fetch the immutable approved snapshot for one artifact, or null when the artifact was never
 *  approved. The export routes 409 on null for an existing artifact (§18.1: only approved
 *  content is publishable). */
export async function getApprovedSnapshotForArtifact(
  artifactId: string,
  db: Queryable = { query },
): Promise<ApprovedSnapshotView | null> {
  if (!isUuid(artifactId)) return null;
  const result = await db.query<SnapshotViewRow>(
    `SELECT ${SNAPSHOT_VIEW_COLUMNS} FROM approved_artifact_snapshots WHERE artifact_id = $1`,
    [artifactId],
  );
  const row = result.rows[0];
  return row === undefined ? null : toSnapshotView(row);
}

/** List every approved snapshot for a run (oldest approval first, a stable bundle order).
 *  Scoped by release_run_id — the tenancy key (constitution §2, no cross-run bleed). */
export async function listApprovedSnapshotsForRun(
  releaseRunId: string,
  db: Queryable = { query },
): Promise<readonly ApprovedSnapshotView[]> {
  if (!isUuid(releaseRunId)) return [];
  const result = await db.query<SnapshotViewRow>(
    `SELECT ${SNAPSHOT_VIEW_COLUMNS} FROM approved_artifact_snapshots
      WHERE release_run_id = $1
      ORDER BY approved_at ASC`,
    [releaseRunId],
  );
  return result.rows.map(toSnapshotView);
}
