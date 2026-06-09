// T5 (spec 006) — artifact_claims + claim_evidence_links repository: typed reads for the
// Gate #2 artifact-review screen and the per-artifact approve/reject writes (PRD §10.3,
// §13.1 claim inspector). P5 (Safety rails) + constitution §5: claims and their evidence are
// built from REDACTED evidence, so the review surface renders no raw text. All queries are
// parameterised and scoped through the owning artifact's release_run_id (the tenancy key; no
// cross-run bleed, constitution §2). An artifact with a blocking check (status='blocked') or
// any unsupported claim is NOT approvable — the approve route enforces that here in code.

import { query, type Queryable } from '@/app/lib/aurora.ts';
import { isUuid } from '@/app/lib/uuid.ts';

/** One evidence item grounding a claim (for the claim inspector's "supporting evidence"). */
export interface ClaimEvidenceRef {
  readonly evidence_item_id: string;
  readonly evidence_type: string;
  readonly redacted_excerpt: string;
  readonly support_score: number | null;
}

/** An artifact_claims row plus its evidence links, as the Gate #2 screen renders it. */
export interface ArtifactClaimView {
  readonly id: string;
  readonly artifact_id: string;
  readonly claim_text: string;
  readonly claim_type: string;
  readonly support_status: string; // 'supported' | 'unsupported'
  readonly risk_level: string; // 'low' | 'medium' | 'high'
  readonly evidence: readonly ClaimEvidenceRef[];
}

/** An artifact plus its decomposed claims — the unit the Gate #2 reviewer approves/rejects. */
export interface ArtifactWithClaims {
  readonly id: string;
  readonly release_run_id: string;
  readonly artifact_type: string;
  readonly title: string | null;
  readonly body_markdown: string | null;
  readonly status: string; // 'draft' | 'blocked' | 'approved' | 'rejected' | 'edited'
  readonly claims: readonly ArtifactClaimView[];
}

interface ArtifactRow {
  id: string;
  release_run_id: string;
  artifact_type: string;
  title: string | null;
  body_markdown: string | null;
  status: string;
}

interface ClaimRow {
  id: string;
  artifact_id: string;
  claim_text: string;
  claim_type: string;
  support_status: string;
  risk_level: string;
}

interface ClaimEvidenceRow {
  claim_id: string;
  evidence_item_id: string;
  evidence_type: string;
  redacted_excerpt: string | null;
  support_score: string | number | null;
}

function asNum(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

const ARTIFACT_COLUMNS = 'id, release_run_id, artifact_type, title, body_markdown, status';

// isApprovable is the pure Gate #2 predicate; it lives in app/lib/artifactApproval.ts so it is
// unit-testable without this server-only module, and is re-exported here for existing callers.
export { isApprovable } from '@/app/lib/artifactApproval.ts';

function attachEvidence(
  claims: readonly ClaimRow[],
  evidenceRows: readonly ClaimEvidenceRow[],
): ArtifactClaimView[] {
  const byClaim = new Map<string, ClaimEvidenceRef[]>();
  for (const link of evidenceRows) {
    const refs = byClaim.get(link.claim_id) ?? [];
    refs.push({
      evidence_item_id: link.evidence_item_id,
      evidence_type: link.evidence_type,
      redacted_excerpt: link.redacted_excerpt ?? '',
      support_score: asNum(link.support_score),
    });
    byClaim.set(link.claim_id, refs);
  }
  return claims.map((c) => ({
    id: c.id,
    artifact_id: c.artifact_id,
    claim_text: c.claim_text,
    claim_type: c.claim_type,
    support_status: c.support_status,
    risk_level: c.risk_level,
    evidence: byClaim.get(c.id) ?? [],
  }));
}

/** List a run's artifacts (newest-first) each with its claims + evidence links, for Gate #2. */
export async function listArtifactsWithClaimsForRun(
  releaseRunId: string,
  limit = 200,
): Promise<readonly ArtifactWithClaims[]> {
  const artifactResult = await query<ArtifactRow>(
    `SELECT ${ARTIFACT_COLUMNS} FROM artifacts
      WHERE release_run_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [releaseRunId, limit],
  );
  const artifacts = artifactResult.rows;
  if (artifacts.length === 0) return [];

  // One round-trip each for all claims and all links, joined to the redacted excerpt.
  const claimResult = await query<ClaimRow>(
    `SELECT ac.id, ac.artifact_id, ac.claim_text, ac.claim_type, ac.support_status,
            ac.risk_level
       FROM artifact_claims ac
       JOIN artifacts a ON a.id = ac.artifact_id
      WHERE a.release_run_id = $1`,
    [releaseRunId],
  );
  const evidenceResult = await query<ClaimEvidenceRow>(
    `SELECT cel.claim_id, cel.evidence_item_id, ei.evidence_type, ei.redacted_excerpt,
            cel.support_score
       FROM claim_evidence_links cel
       JOIN artifact_claims ac ON ac.id = cel.claim_id
       JOIN artifacts a ON a.id = ac.artifact_id
       JOIN evidence_items ei ON ei.id = cel.evidence_item_id
      WHERE a.release_run_id = $1`,
    [releaseRunId],
  );

  const claimsByArtifact = new Map<string, ClaimRow[]>();
  for (const claim of claimResult.rows) {
    const list = claimsByArtifact.get(claim.artifact_id) ?? [];
    list.push(claim);
    claimsByArtifact.set(claim.artifact_id, list);
  }

  return artifacts.map((a) => ({
    id: a.id,
    release_run_id: a.release_run_id,
    artifact_type: a.artifact_type,
    title: a.title,
    body_markdown: a.body_markdown,
    status: a.status,
    claims: attachEvidence(claimsByArtifact.get(a.id) ?? [], evidenceResult.rows),
  }));
}

/** Fetch one artifact with its claims + evidence, or null. Used by the approve/reject routes
 *  to resolve the owning run and enforce the blocked/unsupported gate before a write. */
export async function getArtifactWithClaims(
  artifactId: string,
): Promise<ArtifactWithClaims | null> {
  if (!isUuid(artifactId)) return null;
  const artifactResult = await query<ArtifactRow>(
    `SELECT ${ARTIFACT_COLUMNS} FROM artifacts WHERE id = $1`,
    [artifactId],
  );
  const artifact = artifactResult.rows[0];
  if (artifact === undefined) return null;

  const claimResult = await query<ClaimRow>(
    `SELECT id, artifact_id, claim_text, claim_type, support_status, risk_level
       FROM artifact_claims WHERE artifact_id = $1`,
    [artifactId],
  );
  const evidenceResult = await query<ClaimEvidenceRow>(
    `SELECT cel.claim_id, cel.evidence_item_id, ei.evidence_type, ei.redacted_excerpt,
            cel.support_score
       FROM claim_evidence_links cel
       JOIN evidence_items ei ON ei.id = cel.evidence_item_id
      WHERE cel.claim_id IN (
              SELECT id FROM artifact_claims WHERE artifact_id = $1
            )`,
    [artifactId],
  );

  return {
    id: artifact.id,
    release_run_id: artifact.release_run_id,
    artifact_type: artifact.artifact_type,
    title: artifact.title,
    body_markdown: artifact.body_markdown,
    status: artifact.status,
    claims: attachEvidence(claimResult.rows, evidenceResult.rows),
  };
}

/** The reviewed statuses an artifact may move to at Gate #2 (a human decision sets these;
 *  no self-approval). Mirrors the Python GateDecision values + the pre-gate states. */
export type ArtifactStatus =
  | 'draft'
  | 'blocked'
  | 'approved'
  | 'rejected'
  | 'edited';

/** Apply a reviewed status to one artifact. */
export async function setArtifactStatus(
  artifactId: string,
  status: ArtifactStatus,
): Promise<void> {
  await query(
    `UPDATE artifacts SET status = $2, updated_at = now() WHERE id = $1`,
    [artifactId, status],
  );
}

/** Atomically flip an artifact to 'approved' ONLY while it is still approvable at the DB
 *  level (not blocked, not already approved). Returns true iff this call won the flip — the
 *  Gate #2 concurrency/TOCTOU guard: a double-submit, or an artifact re-blocked by the worker
 *  between the read-time `isApprovable` check and the write, matches no row and returns false.
 *  Pass the transaction client so the flip commits atomically with the approval + snapshot. */
export async function tryApproveArtifact(
  artifactId: string,
  db: Queryable = { query },
): Promise<boolean> {
  const result = await db.query(
    // 'edited' is excluded too: an edited body must be re-validated by the worker checks
    // (which return it to 'draft' or 'blocked') before it can be approved (constitution §5).
    `UPDATE artifacts SET status = 'approved', updated_at = now()
      WHERE id = $1 AND status NOT IN ('blocked', 'approved', 'edited')`,
    [artifactId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Apply a reviewer edit to an artifact's title/body (the narrative, never the claims).
 *  T1 (spec 016) / §18.3: recompute content_hash from the POST-edit title/body in the same
 *  statement ("hash on update"), using the same canonical pre-image (title || E'\n\n' || body) as
 *  the worker and migration 0015, so an edited artifact's stored hash always matches its content. */
export async function applyArtifactEdit(
  artifactId: string,
  edit: { readonly title?: string | undefined; readonly body_markdown?: string | undefined },
): Promise<void> {
  await query(
    `UPDATE artifacts
        SET title         = COALESCE($2, title),
            body_markdown = COALESCE($3, body_markdown),
            content_hash  = encode(
              digest(
                coalesce(COALESCE($2, title), '') || E'\n\n' ||
                coalesce(COALESCE($3, body_markdown), ''),
                'sha256'
              ),
              'hex'
            ),
            updated_at    = now()
      WHERE id = $1`,
    [artifactId, edit.title ?? null, edit.body_markdown ?? null],
  );
}
