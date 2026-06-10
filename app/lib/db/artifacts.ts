// T5 (spec 005) — artifacts repository: typed reads of the draft artifacts a content run
// generated (PRD §10.3). P5 (Safety rails) + constitution §5: drafts are built from
// approved features (themselves built from redacted evidence), so the preview renders no
// raw text. All queries are parameterised and scoped by release_run_id (the tenancy key;
// no cross-run bleed, constitution §2). No status column flips to 'approved' here — Gate #2
// (a later spec) does that through a recorded human decision.

import { query } from '@/app/lib/aurora.ts';

/** An artifacts row as the draft-preview screen renders it. `skill_versions` records which
 *  skill snapshot content-hashes produced the draft (the §18.3 audit trail). */
export interface ArtifactDraft {
  readonly id: string;
  readonly release_run_id: string;
  readonly feature_id: string | null;
  readonly artifact_type: string;
  readonly title: string | null;
  readonly body_markdown: string | null;
  readonly status: string;
  readonly model_id: string | null;
  readonly prompt_version: string | null;
  readonly skill_versions: Readonly<Record<string, string>>;
  readonly created_at: string;
}

interface ArtifactRow {
  id: string;
  release_run_id: string;
  feature_id: string | null;
  artifact_type: string;
  title: string | null;
  body_markdown: string | null;
  status: string;
  model_id: string | null;
  prompt_version: string | null;
  skill_versions_json: unknown;
  // pg returns timestamptz as a Date at runtime; normalise to an ISO string for the client.
  created_at: string | Date;
}

function asSkillVersions(value: unknown): Readonly<Record<string, string>> {
  // jsonb arrives as a parsed object via pg; keep only string→string entries (defensive).
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function mapArtifact(row: ArtifactRow): ArtifactDraft {
  return {
    id: row.id,
    release_run_id: row.release_run_id,
    feature_id: row.feature_id,
    artifact_type: row.artifact_type,
    title: row.title,
    body_markdown: row.body_markdown,
    status: row.status,
    model_id: row.model_id,
    prompt_version: row.prompt_version,
    skill_versions: asSkillVersions(row.skill_versions_json),
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/** A lean (id, type) reference to one of the run's artifacts. T1/T3 (spec 021): the
 *  engagement ingestion boundary checks submitted artifact ids against this set (no
 *  cross-run bleed, constitution §2), the CSV template prefills from it, and the ROI
 *  view derives the run's artifact types from it. */
export interface ArtifactRef {
  readonly id: string;
  readonly artifact_type: string;
}

/** List (id, artifact_type) for every artifact of one run — the run-scoping source of
 *  truth for engagement ingestion (spec 021 AC: foreign artifact ids are rejected). */
export async function listArtifactRefsForRun(
  releaseRunId: string,
): Promise<readonly ArtifactRef[]> {
  const result = await query<{ id: string; artifact_type: string }>(
    `SELECT id, artifact_type FROM artifacts
      WHERE release_run_id = $1
      ORDER BY artifact_type ASC, created_at ASC`,
    [releaseRunId],
  );
  return result.rows.map((row) => ({ id: row.id, artifact_type: row.artifact_type }));
}

/** List a run's generated artifacts (newest-first) for the draft-preview screen. */
export async function listArtifactsForRun(
  releaseRunId: string,
  limit = 200,
): Promise<readonly ArtifactDraft[]> {
  const result = await query<ArtifactRow>(
    `SELECT id, release_run_id, feature_id, artifact_type, title, body_markdown,
            status, model_id, prompt_version, skill_versions_json, created_at
       FROM artifacts
      WHERE release_run_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [releaseRunId, limit],
  );
  return result.rows.map(mapArtifact);
}
