// T1/T3 (spec 021) — engagement_metrics repository (migration 0021): the idempotent write
// side the ingestion route uses and the per-artifact-type read side the ROI view renders.
// P4 (Storage) + constitution §2: every query is parameterised and scoped by release_run_id
// (the tenancy key — no cross-run bleed). GDPR rails: only aggregate counts move through
// here; the table cannot hold user-level data by construction (CHECK-pinned vocabularies +
// numeric value — migration 0021).
//
// Read semantics (mirrored by the Python aurora_engagement adapter so the dashboard and the
// eval rows can never disagree): a row is a cumulative snapshot "as of" a date, so the
// current truth per (artifact, metric) is the FRESHEST row (latest as_of, then created_at);
// summing every daily snapshot would double-count.

import { query, withTransaction } from '@/app/lib/aurora.ts';
import type { EngagementByType, EngagementMetricKind, EngagementSource } from '@/app/lib/engagement.ts';
import { isUuid } from '@/app/lib/uuid.ts';

/** One validated aggregate row as the ingestion boundary accepts it (see
 *  app/lib/engagementIngest.ts — zod-validated BEFORE it reaches this module). */
export interface EngagementRowInput {
  readonly artifact_id: string;
  readonly metric: EngagementMetricKind;
  readonly value: number;
  /** ISO date (YYYY-MM-DD) the aggregate describes. */
  readonly as_of: string;
}

/** Idempotent batch upsert (aurora rules): ON CONFLICT (artifact_id, metric, as_of, source)
 *  overwrites the same row, so re-posting the same CSV/API batch converges instead of
 *  inflating counts. Row-by-row inside ONE transaction (batches are small — the boundary
 *  caps them) so a duplicate key WITHIN a batch is last-write-wins, not an error, and a
 *  failed row rolls back the whole batch (no partial ingest). Returns the row count. */
export async function upsertEngagementRows(
  releaseRunId: string,
  rows: readonly EngagementRowInput[],
  source: EngagementSource,
): Promise<number> {
  if (rows.length === 0) return 0;
  await withTransaction(async (client) => {
    for (const row of rows) {
      await client.query(
        `INSERT INTO engagement_metrics
           (release_run_id, artifact_id, metric, value, as_of, source)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (artifact_id, metric, as_of, source) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = now()`,
        [releaseRunId, row.artifact_id, row.metric, row.value, row.as_of, source],
      );
    }
  });
  return rows.length;
}

interface EngagementTypeRow {
  artifact_type: string;
  metric: string;
  // pg returns SUM as a string; as_of is cast to text in SQL to dodge Date timezone drift.
  value: string | number;
  latest_as_of: string;
}

/** Per-artifact-type engagement for one run: the freshest value per (artifact, metric)
 *  summed by the artifact's type. Types with no reported metric are simply absent — the
 *  pure buildRoiSummary fills those in as "not yet reported" (never zero, spec AC). */
export async function getRunEngagementByType(
  releaseRunId: string,
): Promise<readonly EngagementByType[]> {
  if (!isUuid(releaseRunId)) return [];
  const result = await query<EngagementTypeRow>(
    `SELECT a.artifact_type,
            latest.metric,
            SUM(latest.value)        AS value,
            MAX(latest.as_of)::text  AS latest_as_of
       FROM (
              SELECT DISTINCT ON (artifact_id, metric)
                     artifact_id, metric, value, as_of
                FROM engagement_metrics
               WHERE release_run_id = $1
               ORDER BY artifact_id, metric, as_of DESC, created_at DESC
            ) AS latest
       JOIN artifacts a ON a.id = latest.artifact_id
      GROUP BY a.artifact_type, latest.metric
      ORDER BY a.artifact_type, latest.metric`,
    [releaseRunId],
  );

  const byType = new Map<string, { views: number | null; clicks: number | null; conversions: number | null; latest_as_of: string | null }>();
  for (const row of result.rows) {
    const entry = byType.get(row.artifact_type) ?? {
      views: null,
      clicks: null,
      conversions: null,
      latest_as_of: null,
    };
    const value = Math.trunc(Number(row.value));
    if (row.metric === 'views') entry.views = value;
    else if (row.metric === 'clicks') entry.clicks = value;
    else if (row.metric === 'conversions') entry.conversions = value;
    if (entry.latest_as_of === null || row.latest_as_of > entry.latest_as_of) {
      entry.latest_as_of = row.latest_as_of;
    }
    byType.set(row.artifact_type, entry);
  }
  return [...byType.entries()].map(([artifact_type, e]) => ({ artifact_type, ...e }));
}
