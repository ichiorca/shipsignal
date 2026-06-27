// T6 (spec 008) — media_assets repository: typed reads of a run's rendered demo media (PRD
// §5.4 / migration 0007), for the dashboard preview. P5 (Safety rails) + constitution §4/§5:
// the row carries only the S3 key + provenance — never the binary, never raw evidence — and
// the binary itself reaches the browser ONLY through a server-minted presigned URL (the
// /api/media/[mediaId]/playback route), never a public object. All queries are parameterised
// and scoped by release_run_id (the tenancy key; no cross-run bleed, constitution §2).

import { query, type Queryable } from '@/app/lib/aurora.ts';

/** A media_assets row as the preview screen renders it. `provenance` is the §18.3 audit trail
 *  (source demo_script artifact, validated click-path hash, narration content hash, voice/model
 *  ids) that ties the rendered media back to its Gate#2-approved source + inputs. */
export interface MediaAsset {
  readonly id: string;
  readonly release_run_id: string;
  readonly feature_id: string | null;
  // App-facing semantic names mapped from the §10.6 columns artifact_id / metadata_json
  // (spec 014 T2 — the documented, consistent mapping applied app-wide).
  readonly source_artifact_id: string | null;
  readonly media_type: string;
  // Nullable on a §16.3 broken-step asset (no final media stored). content_type/duration too.
  readonly content_type: string | null;
  readonly duration_seconds: number | null;
  // §10.6 transcript — the preserved narration script (§16.3); null when none was captured.
  readonly transcript: string | null;
  readonly status: string;
  readonly provenance: Readonly<Record<string, string>>;
  readonly created_at: string;
  // External-publish provenance (migration 0037) — null until an operator publishes the demo
  // video to a platform (e.g. YouTube). The dashboard links to external_url when present.
  readonly external_platform: string | null;
  readonly external_url: string | null;
  readonly published_at: string | null;
}

interface MediaAssetRow {
  id: string;
  release_run_id: string;
  feature_id: string | null;
  // §10.6 column name (renamed from source_artifact_id in migration 0013).
  artifact_id: string | null;
  media_type: string;
  content_type: string | null;
  // pg returns NUMERIC as a string; normalise to a number | null for the client.
  duration_seconds: string | number | null;
  transcript: string | null;
  status: string;
  // §10.6 column name (renamed from provenance_json in migration 0013).
  metadata_json: unknown;
  created_at: string | Date;
  external_platform: string | null;
  external_url: string | null;
  published_at: string | Date | null;
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
    // Map the §10.6 columns to the app's semantic field names (spec 014 T2 documented mapping).
    source_artifact_id: row.artifact_id,
    media_type: row.media_type,
    content_type: row.content_type,
    duration_seconds: asNum(row.duration_seconds),
    transcript: row.transcript,
    status: row.status,
    provenance: asProvenance(row.metadata_json),
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    external_platform: row.external_platform,
    external_url: row.external_url,
    published_at:
      row.published_at === null
        ? null
        : row.published_at instanceof Date
          ? row.published_at.toISOString()
          : String(row.published_at),
  };
}

const MEDIA_COLUMNS =
  'id, release_run_id, feature_id, artifact_id, media_type, content_type, ' +
  'duration_seconds, transcript, status, metadata_json, created_at, ' +
  'external_platform, external_url, published_at';

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
  const result = await query<{ s3_uri: string | null; content_type: string | null }>(
    `SELECT s3_uri, content_type FROM media_assets WHERE id = $1`,
    [mediaId],
  );
  const row = result.rows[0];
  // A §16.3 broken-step asset can have no stored media (null s3_uri) — it is not playable, so
  // the playback route treats it as "not found" (404) rather than presigning a missing object.
  if (row === undefined || row.s3_uri === null) return null;
  return { s3_uri: row.s3_uri, content_type: row.content_type ?? 'application/octet-stream' };
}

/** Server-only view a publish route needs to decide whether/what to upload: the media's kind,
 *  readiness, S3 location, and whether it was already published externally (idempotency). */
export interface MediaForPublish {
  readonly release_run_id: string;
  readonly media_type: string;
  readonly status: string;
  readonly s3_uri: string | null;
  readonly content_type: string | null;
  readonly external_url: string | null;
}

/** Load the publish-relevant fields for one media asset (incl. the server-only s3_uri). Null when
 *  the asset does not exist. */
export async function getMediaForPublish(mediaId: string): Promise<MediaForPublish | null> {
  const result = await query<{
    release_run_id: string;
    media_type: string;
    status: string;
    s3_uri: string | null;
    content_type: string | null;
    external_url: string | null;
  }>(
    `SELECT release_run_id, media_type, status, s3_uri, content_type, external_url
       FROM media_assets WHERE id = $1`,
    [mediaId],
  );
  return result.rows[0] ?? null;
}

/** Record a successful external publication (migration 0037). Sets the platform, watch URL,
 *  platform video id, the accountable reviewer, and published_at = now(). */
export async function recordMediaPublication(
  mediaId: string,
  publication: {
    readonly platform: string;
    readonly url: string;
    readonly videoId: string | null;
    readonly publishedBy: string;
  },
  db: Queryable = { query },
): Promise<void> {
  await db.query(
    `UPDATE media_assets
        SET external_platform = $2, external_url = $3, external_video_id = $4,
            published_by = $5, published_at = now()
      WHERE id = $1`,
    [mediaId, publication.platform, publication.url, publication.videoId, publication.publishedBy],
  );
}
