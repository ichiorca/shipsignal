// T3/T4 (spec 021) — input contracts for engagement ingestion: the JSON batch schema and
// the CSV parser behind POST /api/releases/{releaseRunId}/engagement.
// P5 (Safety rails): every inbound body is untrusted; validate at the boundary with zod
// (.strict() everywhere — the spec AC: rows with unexpected fields are REJECTED, so a
// user-level field like user_id/email can never ride in). GDPR rails: the accepted shape
// is aggregate counts only; `source` is NEVER client-supplied — the route derives it from
// the ingestion door (JSON → 'api', uploaded CSV → 'manual_csv'), so provenance cannot be
// spoofed. Pure module (no DB / server imports) — the parser and schemas are unit-tested
// directly; the route wires them to the repository.

import { z } from 'zod';
import { ENGAGEMENT_METRIC_KINDS } from './engagement.ts';

/** One batch is bounded: big enough for every (artifact × metric × day) of a real run,
 *  small enough that a runaway upload cannot wedge the route. */
export const MAX_BATCH_ROWS = 1000;

/** Upload size cap for the CSV door (a 1000-row CSV is ~60 KiB; 256 KiB is generous). */
export const MAX_CSV_BYTES = 256 * 1024;

// A calendar date the aggregate describes (YYYY-MM-DD), validated as a REAL date so
// 2026-02-31 is rejected, not coerced.
const asOf = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'as_of must be an ISO date (YYYY-MM-DD)')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 0));
    return (
      date.getUTCFullYear() === y && date.getUTCMonth() === (m ?? 1) - 1 && date.getUTCDate() === d
    );
  }, 'as_of must be a real calendar date');

/** One aggregate row. Closed shape (.strict()): an unexpected field — including anything
 *  user-level — fails validation rather than being silently dropped (spec AC). */
export const engagementRowSchema = z
  .object({
    artifact_id: z.string().uuid('artifact_id must be a UUID'),
    metric: z.enum(ENGAGEMENT_METRIC_KINDS),
    value: z
      .number()
      .int('value must be an integer')
      .min(0, 'value must be >= 0')
      .max(1_000_000_000_000, 'value is implausibly large'),
    as_of: asOf,
  })
  .strict();

export type EngagementRow = z.infer<typeof engagementRowSchema>;

/** POST body for the JSON door: { rows: [...] }. */
export const engagementBatchSchema = z
  .object({
    rows: z.array(engagementRowSchema).min(1).max(MAX_BATCH_ROWS),
  })
  .strict();

export type ParseRowsResult =
  | { readonly ok: true; readonly rows: readonly EngagementRow[] }
  | { readonly ok: false; readonly errors: readonly string[] };

const CSV_HEADER = 'artifact_id,metric,value,as_of';
const MAX_REPORTED_ERRORS = 20;

function rowError(line: number, message: string): string {
  return `line ${line}: ${message}`;
}

/** Parse + validate the uploaded CSV (the T4 template shape: a header row then one
 *  aggregate row per line, no quoting — none of the four fields can contain a comma).
 *  Row-level error reporting (spec T4): every offending line is named with its line
 *  number and a user-safe reason; errors are capped so a wholly-wrong file stays
 *  readable. Returns rows ONLY when the whole file is clean (no partial ingest). */
export function parseEngagementCsv(text: string): ParseRowsResult {
  // Strip a UTF-8 BOM (spreadsheet exports often add one) and normalise line endings.
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/);
  const headerLine = lines[0]?.trim().toLowerCase() ?? '';
  if (headerLine !== CSV_HEADER) {
    return {
      ok: false,
      errors: [rowError(1, `header must be exactly "${CSV_HEADER}"`)],
    };
  }

  const rows: EngagementRow[] = [];
  const errors: string[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (line === '') continue; // blank lines (incl. the trailing newline) are fine
    if (errors.length >= MAX_REPORTED_ERRORS) {
      errors.push('more errors not shown; fix the reported lines and re-upload');
      break;
    }
    const fields = line.split(',').map((f) => f.trim());
    if (fields.length !== 4) {
      errors.push(rowError(i + 1, `expected 4 comma-separated fields, got ${fields.length}`));
      continue;
    }
    const valueNumber = /^\d+$/.test(fields[2] ?? '') ? Number(fields[2]) : NaN;
    const candidate = {
      artifact_id: fields[0] ?? '',
      metric: fields[1] ?? '',
      value: Number.isNaN(valueNumber) ? -1 : valueNumber,
      as_of: fields[3] ?? '',
    };
    const parsed = engagementRowSchema.safeParse(candidate);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const field = first && first.path.length > 0 ? `${first.path.join('.')}: ` : '';
      errors.push(rowError(i + 1, `${field}${first?.message ?? 'invalid row'}`));
      continue;
    }
    rows.push(parsed.data);
  }

  if (errors.length > 0) return { ok: false, errors };
  if (rows.length === 0) {
    return { ok: false, errors: ['the file has a header but no data rows'] };
  }
  if (rows.length > MAX_BATCH_ROWS) {
    return { ok: false, errors: [`at most ${MAX_BATCH_ROWS} rows per upload`] };
  }
  return { ok: true, rows };
}

/** The run-scoping gate (spec AC: artifact ids must belong to the run — cross-run bleed
 *  rejected). Returns user-safe, row-numbered errors; never echoes the foreign id's data. */
export function findForeignArtifactRows(
  rows: readonly EngagementRow[],
  runArtifactIds: ReadonlySet<string>,
): readonly string[] {
  const errors: string[] = [];
  rows.forEach((row, index) => {
    if (!runArtifactIds.has(row.artifact_id)) {
      errors.push(`row ${index + 1}: artifact does not belong to this release run`);
    }
  });
  return errors;
}

/** The CSV template the dashboard offers for download (T4): the exact header the parser
 *  requires plus one prefilled line per (artifact, metric) so a reviewer only types
 *  numbers and dates. Pure + shared so the template and the parser can never drift. */
export function buildCsvTemplate(
  artifacts: readonly { readonly id: string; readonly artifact_type: string }[],
  asOfDate: string,
): string {
  const lines = [CSV_HEADER];
  for (const artifact of artifacts) {
    for (const metric of ENGAGEMENT_METRIC_KINDS) {
      lines.push(`${artifact.id},${metric},0,${asOfDate}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

export { CSV_HEADER };
