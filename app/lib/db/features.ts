// T5/T6 (spec 004) — feature_clusters repository: typed reads + Gate #1 status writes
// over the tables defined in db/migrations/versions/0004 (PRD §10.2).
// P5 (Safety rails) + constitution §5: the review screen renders REDACTED feature data
// only (the manifest is built from redacted evidence). All queries are parameterised and
// scoped by release_run_id (the tenancy key; no cross-run bleed, constitution §2).
// No status column flips to 'approved' on its own — only setFeatureStatus, driven by a
// recorded human decision at the gate, advances it (no self-approval path).

import { query } from '@/app/lib/aurora.ts';

/** A feature_clusters row plus its linked evidence, as the Gate #1 review screen renders
 *  it. `evidence` carries redacted excerpts only — the manifest never holds raw text. */
export interface FeatureCluster {
  readonly id: string;
  readonly release_run_id: string;
  readonly title: string;
  readonly summary_internal: string | null;
  readonly user_value: string | null;
  readonly audiences: readonly string[];
  readonly change_type: string | null;
  readonly surface_area: readonly string[];
  readonly marketability_score: number | null;
  readonly demoability_score: number | null;
  readonly confidence: number | null;
  readonly launch_risk: string | null;
  readonly status: string;
  readonly reviewer_notes: string | null;
  readonly evidence: readonly FeatureEvidenceRef[];
}

/** One evidence item linked to a feature (for the "supporting evidence" column). */
export interface FeatureEvidenceRef {
  readonly evidence_item_id: string;
  readonly evidence_type: string;
  readonly redacted_excerpt: string;
  readonly relevance_score: number | null;
}

interface FeatureRow {
  id: string;
  release_run_id: string;
  title: string;
  summary_internal: string | null;
  user_value: string | null;
  audiences: unknown;
  change_type: string | null;
  surface_area: unknown;
  marketability_score: string | number | null;
  demoability_score: string | number | null;
  confidence: string | number | null;
  launch_risk: string | null;
  status: string;
  reviewer_notes: string | null;
}

interface EvidenceLinkRow {
  feature_id: string;
  evidence_item_id: string;
  evidence_type: string;
  redacted_excerpt: string | null;
  relevance_score: string | number | null;
}

function asStringArray(value: unknown): readonly string[] {
  // text[] arrives as a JS array via pg; be defensive about shape.
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function asNum(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

const FEATURE_COLUMNS =
  'id, release_run_id, title, summary_internal, user_value, audiences, change_type, ' +
  'surface_area, marketability_score, demoability_score, confidence, launch_risk, ' +
  'status, reviewer_notes';

function mapFeature(row: FeatureRow, evidence: readonly FeatureEvidenceRef[]): FeatureCluster {
  return {
    id: row.id,
    release_run_id: row.release_run_id,
    title: row.title,
    summary_internal: row.summary_internal,
    user_value: row.user_value,
    audiences: asStringArray(row.audiences),
    change_type: row.change_type,
    surface_area: asStringArray(row.surface_area),
    marketability_score: asNum(row.marketability_score),
    demoability_score: asNum(row.demoability_score),
    confidence: asNum(row.confidence),
    launch_risk: row.launch_risk,
    status: row.status,
    reviewer_notes: row.reviewer_notes,
    evidence,
  };
}

/** List a run's features (newest-first) with their linked redacted evidence, for Gate #1. */
export async function listFeaturesForRun(
  releaseRunId: string,
  limit = 200,
): Promise<readonly FeatureCluster[]> {
  const featureResult = await query<FeatureRow>(
    `SELECT ${FEATURE_COLUMNS} FROM feature_clusters
       WHERE release_run_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
    [releaseRunId, limit],
  );
  const features = featureResult.rows;
  if (features.length === 0) return [];

  // One round-trip for all links, joined to the redacted excerpt for display.
  const linkResult = await query<EvidenceLinkRow>(
    `SELECT fel.feature_id, fel.evidence_item_id, ei.evidence_type,
            ei.redacted_excerpt, fel.relevance_score
       FROM feature_evidence_links fel
       JOIN evidence_items ei ON ei.id = fel.evidence_item_id
       JOIN feature_clusters fc ON fc.id = fel.feature_id
      WHERE fc.release_run_id = $1`,
    [releaseRunId],
  );

  const byFeature = new Map<string, FeatureEvidenceRef[]>();
  for (const link of linkResult.rows) {
    const refs = byFeature.get(link.feature_id) ?? [];
    refs.push({
      evidence_item_id: link.evidence_item_id,
      evidence_type: link.evidence_type,
      redacted_excerpt: link.redacted_excerpt ?? '',
      relevance_score: asNum(link.relevance_score),
    });
    byFeature.set(link.feature_id, refs);
  }

  return features.map((row) => mapFeature(row, byFeature.get(row.id) ?? []));
}

/** Fetch one feature (without evidence), or null. Used by the per-feature API routes to
 *  resolve the owning release_run_id and confirm existence before a decision write. */
export async function getFeature(featureId: string): Promise<FeatureCluster | null> {
  const result = await query<FeatureRow>(
    `SELECT ${FEATURE_COLUMNS} FROM feature_clusters WHERE id = $1`,
    [featureId],
  );
  return result.rows[0] ? mapFeature(result.rows[0], []) : null;
}

/** The reviewed statuses a feature may move to at Gate #1 (no self-approval; a human
 *  decision sets these). Mirrors the Python GateDecision values + 'pending_review'. */
export type FeatureStatus = 'pending_review' | 'approved' | 'rejected' | 'edited';

/** Apply a reviewed status (+ optional reviewer notes) to one feature. */
export async function setFeatureStatus(
  featureId: string,
  status: FeatureStatus,
  reviewerNotes?: string,
): Promise<void> {
  await query(
    `UPDATE feature_clusters
        SET status = $2,
            reviewer_notes = COALESCE($3, reviewer_notes),
            updated_at = now()
      WHERE id = $1`,
    [featureId, status, reviewerNotes ?? null],
  );
}

/** Fields a reviewer may edit at Gate #1 (the narrative + targeting, never the scores —
 *  those are deterministic). Undefined fields are left unchanged. */
export interface FeatureEdit {
  // `| undefined` on each so a parsed (optional) zod edit object is assignable under
  // exactOptionalPropertyTypes; COALESCE leaves any omitted field unchanged.
  readonly title?: string | undefined;
  readonly summary_internal?: string | undefined;
  readonly user_value?: string | undefined;
  readonly audiences?: readonly string[] | undefined;
  readonly change_type?: string | undefined;
  readonly surface_area?: readonly string[] | undefined;
}

/** Apply a reviewer edit to a feature's narrative fields. COALESCE keeps any field the
 *  reviewer left out unchanged. */
export async function applyFeatureEdit(featureId: string, edit: FeatureEdit): Promise<void> {
  await query(
    `UPDATE feature_clusters
        SET title          = COALESCE($2, title),
            summary_internal = COALESCE($3, summary_internal),
            user_value     = COALESCE($4, user_value),
            audiences      = COALESCE($5, audiences),
            change_type    = COALESCE($6, change_type),
            surface_area   = COALESCE($7, surface_area),
            updated_at     = now()
      WHERE id = $1`,
    [
      featureId,
      edit.title ?? null,
      edit.summary_internal ?? null,
      edit.user_value ?? null,
      edit.audiences ? [...edit.audiences] : null,
      edit.change_type ?? null,
      edit.surface_area ? [...edit.surface_area] : null,
    ],
  );
}
