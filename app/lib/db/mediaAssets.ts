// T6 (spec 008) — media_assets repository: typed reads of a run's rendered demo media (PRD
// §5.4 / migration 0007), for the dashboard preview. P5 (Safety rails) + constitution §4/§5:
// the row carries only the S3 key + provenance — never the binary, never raw evidence — and
// the binary itself reaches the browser ONLY through a server-minted presigned URL (the
// /api/media/[mediaId]/playback route), never a public object. All queries are parameterised
// and scoped by release_run_id (the tenancy key; no cross-run bleed, constitution §2).

import { query } from '@/app/lib/aurora.ts';

/** A media_assets row as the preview screen renders it. `provenance` is the §18.3 audit trail
 *  (source demo_script artifact, validated click-path hash, narration content hash, voice/model
 *  ids) that ties the rendered media back to its Gate#2-approved source + inputs. */
export interface MediaAsset {
  readonly id: string;
  readonly release_run_id: string;
  readonly feature_id: string | null;
  readonly source_artifact_id: string | null;
  readonly media_type: string;
  readonly content_type: string;
  readonly duration_seconds: number | null;
  readonly status: string;
  readonly provenance: Readonly<Record<string, string>>;
  readonly created_at: string;
}

interface MediaAssetRow {
  id: string;
  release_run_id: string;
  feature_id: string | null;
  source_artifact_id: string | null;
  media_type: string;
  content_type: string;
  // pg returns NUMERIC as a string; normalise to a number | null for the client.
  duration_seconds: string | number | null;
  status: string;
  provenance_json: unknown;
  created_at: string | Date;
}

function asProvenance(value: unknown): Readonly<Record<string, string>> {
  // jsonb arrives parsed via pg; keep only string→string entries (defensive, never raw text).
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function asNum(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

function mapAsset(row: MediaAssetRow): MediaAsset {
  return {
    id: row.id,
    release_run_id: row.release_run_id,
    feature_id: row.feature_id,
    source_artifact_id: row.source_artifact_id,
    media_type: row.media_type,
    content_type: row.content_type,
    duration_seconds: asNum(row.duration_seconds),
    status: row.status,
    provenance: asProvenance(row.provenance_json),
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

const MEDIA_COLUMNS =
  'id, release_run_id, feature_id, source_artifact_id, media_type, content_type, ' +
  'duration_seconds, status, provenance_json, created_at';

/** List a run's media assets (newest-first) for the preview screen. */
export async function listMediaAssetsForRun(
  releaseRunId: string,
  limit = 50,
): Promise<readonly MediaAsset[]> {
  const result = await query<MediaAssetRow>(
    `SELECT ${MEDIA_COLUMNS}
       FROM media_assets
      WHERE release_run_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [releaseRunId, limit],
  );
  return result.rows.map(mapAsset);
}

/** The S3 location of one media asset, for the playback route to presign. Returns null if the
 *  asset does not exist. Only the route handler (server context) calls this; the s3_uri never
 *  reaches the client — the route 302s to a short-lived signed URL instead. */
export async function getMediaPlaybackLocation(
  mediaId: string,
): Promise<{ readonly s3_uri: string; readonly content_type: string } | null> {
  const result = await query<{ s3_uri: string; content_type: string }>(
    `SELECT s3_uri, content_type FROM media_assets WHERE id = $1`,
    [mediaId],
  );
  const row = result.rows[0];
  return row === undefined ? null : { s3_uri: row.s3_uri, content_type: row.content_type };
}
