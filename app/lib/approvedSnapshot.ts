// T2 (spec 016) — assemble the §18.3 immutable approved-content record (pure; unit-tested).
// P5 (Safety rails) / §18.3: at Gate #2 approval the approved content must be snapshotted into a
// tamper-evident record DISTINCT from the mutable artifacts row, capturing every §18.3 field. This
// module builds that record as a pure function of the artifact (with its claims/evidence) + the
// audit fields + the reviewer decision, so the assembly (evidence-id de-dup, claim-support
// projection, content hashing) is testable without a DB. The DB write lives in
// app/lib/db/approvedSnapshots.ts; the approve route wires the two together.

// Relative value import so this pure helper is unit-testable under `node --test` (which does not
// resolve the `@/` tsconfig path alias). The claims import is type-only (erased at runtime).
import { artifactContentHash } from './contentHash.ts';
import type { ArtifactWithClaims } from './db/claims.ts';

/** The per-artifact audit fields that live on the mutable row but must be frozen into the snapshot
 *  (§18.3: model ID, prompt/template version, skill versions used, generated timestamp). */
export interface ArtifactAuditFields {
  readonly model_id: string | null;
  readonly prompt_version: string | null;
  readonly skill_versions: Readonly<Record<string, string>>;
  readonly generated_at: string | null;
}

/** One claim's support status as recorded in the snapshot (§18.3 "claim support status"). */
export interface ClaimSupportEntry {
  readonly claim_id: string;
  readonly support_status: string;
  readonly risk_level: string;
}

/** The fully-assembled §18.3 approved-content record, ready to insert. Immutable once written. */
export interface ApprovedSnapshotRecord {
  readonly artifact_id: string;
  readonly release_run_id: string;
  readonly approval_id: string | null;
  readonly artifact_type: string;
  readonly model_id: string | null;
  readonly prompt_version: string | null;
  readonly skill_versions: Readonly<Record<string, string>>;
  readonly evidence_ids: readonly string[];
  readonly claim_support: readonly ClaimSupportEntry[];
  readonly reviewer: string;
  readonly reviewer_decision: string;
  readonly final_title: string | null;
  readonly final_body_markdown: string;
  readonly content_hash: string;
  readonly generated_at: string | null;
}

export interface ApprovalContext {
  readonly reviewer: string;
  readonly decision: string;
  readonly approval_id: string | null;
}

/** Distinct evidence-item ids grounding any of the artifact's claims, sorted for a stable record
 *  (§18.3 "evidence IDs"). */
function collectEvidenceIds(artifact: ArtifactWithClaims): string[] {
  const ids = new Set<string>();
  for (const claim of artifact.claims) {
    for (const ev of claim.evidence) ids.add(ev.evidence_item_id);
  }
  return [...ids].sort();
}

/** Build the immutable §18.3 approved-content record from the approved artifact + its audit fields.
 *  Pure: the content hash is computed from the FINAL title/body (whatever the reviewer approved),
 *  so it is stable and tamper-evident. `final_body_markdown` falls back to '' only if the row has a
 *  null body (it should not at approval). */
export function buildApprovedSnapshot(
  artifact: ArtifactWithClaims,
  audit: ArtifactAuditFields,
  approval: ApprovalContext,
): ApprovedSnapshotRecord {
  const finalBody = artifact.body_markdown ?? '';
  return {
    artifact_id: artifact.id,
    release_run_id: artifact.release_run_id,
    approval_id: approval.approval_id,
    artifact_type: artifact.artifact_type,
    model_id: audit.model_id,
    prompt_version: audit.prompt_version,
    skill_versions: audit.skill_versions,
    evidence_ids: collectEvidenceIds(artifact),
    claim_support: artifact.claims.map((c) => ({
      claim_id: c.id,
      support_status: c.support_status,
      risk_level: c.risk_level,
    })),
    reviewer: approval.reviewer,
    reviewer_decision: approval.decision,
    final_title: artifact.title,
    final_body_markdown: finalBody,
    content_hash: artifactContentHash(artifact.title, finalBody),
    generated_at: audit.generated_at,
  };
}
