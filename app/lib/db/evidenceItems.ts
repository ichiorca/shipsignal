// T5 (spec 002) — evidence_items repository: typed reads over the table defined in
// db/migrations/versions/0003_evidence_items.py (PRD §6.3 / §10.1).
// P5 (Safety rails) + constitution §4: the dashboard only ever receives REDACTED
// content. The raw-excerpt S3 URI is deliberately NOT part of the client-facing
// `EvidenceItem` shape — it is fetched separately, server-side, by the presigned-URL
// route (app/api/evidence/[id]/raw). All queries are parameterised and scoped by
// release_run_id (the tenancy key; no cross-run bleed, constitution §2).

import { query } from '@/app/lib/aurora.ts';

/** An evidence row as the run-detail page renders it. Carries redacted content only —
 *  never the raw excerpt, and not the S3 URI (raw access goes through a presigned
 *  route). `has_raw_blob` tells the UI whether to offer a "view full excerpt" link. */
export interface EvidenceItem {
  readonly id: string;
  readonly release_run_id: string;
  readonly evidence_type: string;
  readonly source: string;
  readonly source_url: string | null;
  readonly repo: string;
  readonly file_path: string | null;
  readonly symbol_name: string | null;
  readonly redacted_excerpt: string;
  readonly risk_flags: readonly string[];
  readonly confidence: number | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly has_raw_blob: boolean;
}

interface EvidenceItemRow {
  id: string;
  release_run_id: string;
  evidence_type: string;
  source: string;
  source_url: string | null;
  repo: string;
  file_path: string | null;
  symbol_name: string | null;
  redacted_excerpt: string | null;
  risk_flags: unknown;
  confidence: string | number | null;
  metadata_json: unknown;
  has_raw_blob: boolean;
}

function asStringArray(value: unknown): readonly string[] {
  // jsonb risk_flags arrives parsed; be defensive about shape (untrusted-at-rest).
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapRow(row: EvidenceItemRow): EvidenceItem {
  return {
    id: row.id,
    release_run_id: row.release_run_id,
    evidence_type: row.evidence_type,
    source: row.source,
    source_url: row.source_url,
    repo: row.repo,
    file_path: row.file_path,
    symbol_name: row.symbol_name,
    redacted_excerpt: row.redacted_excerpt ?? '',
    risk_flags: asStringArray(row.risk_flags),
    confidence: row.confidence === null ? null : Number(row.confidence),
    metadata: asRecord(row.metadata_json),
    has_raw_blob: row.has_raw_blob,
  };
}

// `has_raw_blob` is computed in SQL so the URI itself never crosses into JS land for
// the listing path; only the presign route selects the actual URI.
const SELECT_COLUMNS =
  'id, release_run_id, evidence_type, source, source_url, repo, file_path, symbol_name, ' +
  'redacted_excerpt, risk_flags, confidence, metadata_json, ' +
  '(raw_excerpt_s3_uri IS NOT NULL) AS has_raw_blob';

/** List a run's evidence, newest-first, for the run-detail view. */
export async function listEvidenceForRun(
  releaseRunId: string,
  limit = 200,
): Promise<readonly EvidenceItem[]> {
  const result = await query<EvidenceItemRow>(
    `SELECT ${SELECT_COLUMNS} FROM evidence_items
       WHERE release_run_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
    [releaseRunId, limit],
  );
  return result.rows.map(mapRow);
}

/** Server-only: resolve the S3 URI of one evidence item's full (redacted) excerpt.
 *  Used exclusively by the presigned-URL route — never returned to the client. */
export async function getEvidenceRawLocation(
  evidenceId: string,
): Promise<{ readonly release_run_id: string; readonly s3_uri: string } | null> {
  const result = await query<{ release_run_id: string; raw_excerpt_s3_uri: string | null }>(
    'SELECT release_run_id, raw_excerpt_s3_uri FROM evidence_items WHERE id = $1',
    [evidenceId],
  );
  const row = result.rows[0];
  if (row === undefined || row.raw_excerpt_s3_uri === null) return null;
  return { release_run_id: row.release_run_id, s3_uri: row.raw_excerpt_s3_uri };
}
