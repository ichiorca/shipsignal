// company_voice_exemplars repository (migration 0025) — the company's own published content that
// grounds "in your voice". The app layer manages the TEXT (create/list/delete via the /settings
// UI); the EMBEDDING is owned by the worker (Bedrock — constitution §1: no model calls from the
// Vercel app), so the app never selects or writes the vector — it only reports whether one exists.

import { query, type Queryable } from '@/app/lib/aurora.ts';
import { isUuid } from '@/app/lib/uuid.ts';
import type { VoiceExemplar, VoiceExemplarInput } from '@/app/lib/brandBrain.ts';

interface VoiceRow {
  id: string;
  title: string;
  body_text: string;
  channel: string;
  source: string | null;
  icp_segment_id: string | null;
  embedded: boolean;
}

// `embedding IS NOT NULL` is projected as `embedded` so the UI can show "pending embedding"
// without the app ever touching the vector column.
const COLUMNS =
  'id, title, body_text, channel, source, icp_segment_id, (embedding IS NOT NULL) AS embedded';

function mapRow(row: VoiceRow): VoiceExemplar {
  return {
    id: row.id,
    title: row.title,
    body_text: row.body_text,
    channel: row.channel,
    source: row.source,
    icp_segment_id: row.icp_segment_id,
    embedded: row.embedded,
  };
}

export async function listVoiceExemplars(): Promise<readonly VoiceExemplar[]> {
  const result = await query<VoiceRow>(
    `SELECT ${COLUMNS} FROM company_voice_exemplars ORDER BY created_at DESC`,
  );
  return result.rows.map(mapRow);
}

export async function createVoiceExemplar(
  input: VoiceExemplarInput,
  db: Queryable = { query },
): Promise<VoiceExemplar> {
  const result = await db.query<VoiceRow>(
    `INSERT INTO company_voice_exemplars (title, body_text, channel, source, icp_segment_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [
      input.title,
      input.body_text,
      input.channel,
      input.source ?? null,
      input.icp_segment_id ?? null,
    ],
  );
  return mapRow(result.rows[0]!);
}

export async function deleteVoiceExemplar(id: string, db: Queryable = { query }): Promise<boolean> {
  if (!isUuid(id)) return false;
  const result = await db.query('DELETE FROM company_voice_exemplars WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
