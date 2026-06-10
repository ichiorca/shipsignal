// T3/T4 (spec 021) — POST /api/releases/{releaseRunId}/engagement: the single ingestion
// door for aggregate engagement rows. Two content types, one contract:
//   * application/json  { rows: [...] }            → source 'api'
//   * multipart/form-data with a "file" CSV field  → source 'manual_csv' (the T4 panel)
// The source is derived from the door, never client-supplied (provenance can't be spoofed).
//
// P5 (Safety rails): boundary-validated with strict zod schemas (unexpected fields — incl.
// anything user-level — are rejected with a user-safe 400, spec AC); artifact ids are
// checked against the run's own artifacts (constitution §2: cross-run bleed rejected);
// writes are an idempotent upsert on (artifact_id, metric, as_of, source) in one
// transaction. GDPR rails: only aggregate counts pass through; nothing user-level can be
// persisted (the schema has no such field and the table CHECK-pins its vocabularies).

import { NextResponse } from 'next/server';
import { parseBody } from '@/app/lib/featureReview.ts';
import {
  MAX_CSV_BYTES,
  engagementBatchSchema,
  findForeignArtifactRows,
  parseEngagementCsv,
  type EngagementRow,
} from '@/app/lib/engagementIngest.ts';
import type { EngagementSource } from '@/app/lib/engagement.ts';
import { listArtifactRefsForRun } from '@/app/lib/db/artifacts.ts';
import { upsertEngagementRows } from '@/app/lib/db/engagementMetrics.ts';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ releaseRunId: string }>;
}

type RowsResult =
  | { readonly ok: true; readonly rows: readonly EngagementRow[]; readonly source: EngagementSource }
  | { readonly ok: false; readonly response: NextResponse };

function badRequest(error: string, details?: readonly string[]): NextResponse {
  return NextResponse.json(
    details === undefined ? { error } : { error, details },
    { status: 400 },
  );
}

/** The CSV door (multipart/form-data, field "file"): size-capped, parsed + row-level
 *  validated server-side. */
async function rowsFromCsv(request: Request): Promise<RowsResult> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, response: badRequest('request must be multipart/form-data with a "file" field') };
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return { ok: false, response: badRequest('a CSV "file" field is required') };
  }
  if (file.size > MAX_CSV_BYTES) {
    return { ok: false, response: badRequest('the CSV is too large (max 256 KiB)') };
  }
  const parsed = parseEngagementCsv(await file.text());
  if (!parsed.ok) {
    return { ok: false, response: badRequest('the CSV has invalid rows', parsed.errors) };
  }
  return { ok: true, rows: parsed.rows, source: 'manual_csv' };
}

/** The JSON door: a strict, bounded batch. */
async function rowsFromJson(request: Request): Promise<RowsResult> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: badRequest('request body must be valid JSON') };
  }
  const parsed = parseBody(engagementBatchSchema, body);
  if (!parsed.ok) {
    return { ok: false, response: badRequest('invalid engagement batch', parsed.errors) };
  }
  return { ok: true, rows: parsed.value.rows, source: 'api' };
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { releaseRunId } = await context.params;

  const run = await getReleaseRun(releaseRunId);
  if (run === null) {
    return NextResponse.json({ error: 'release run not found' }, { status: 404 });
  }

  const contentType = request.headers.get('content-type') ?? '';
  const result = contentType.includes('multipart/form-data')
    ? await rowsFromCsv(request)
    : await rowsFromJson(request);
  if (!result.ok) return result.response;

  // Constitution §2 (tenancy): every submitted artifact id must belong to THIS run.
  const artifactRefs = await listArtifactRefsForRun(run.id);
  const foreign = findForeignArtifactRows(result.rows, new Set(artifactRefs.map((a) => a.id)));
  if (foreign.length > 0) {
    return badRequest('one or more rows reference artifacts outside this release run', foreign);
  }

  const accepted = await upsertEngagementRows(run.id, result.rows, result.source);
  return NextResponse.json(
    { release_run_id: run.id, accepted, source: result.source },
    { status: 200 },
  );
}
