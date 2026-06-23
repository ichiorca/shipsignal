// voice_guide repository (migration 0033) — the singleton structured brand-voice guide. The row is
// seeded by the migration and only ever UPDATEd in place (id pinned to 'default'), so reads always
// return one guide. Operator-authored config (no secret/PII); all queries parameterised.

import { query, type Queryable } from '@/app/lib/aurora.ts';
import type { VoiceGuide, VoiceGuideInput } from '@/app/lib/brandBrain.ts';

const GUIDE_ID = 'default';
const COLUMNS = 'tone, reading_level, do_rules, dont_rules, prefer_terms, avoid_terms, notes';

interface VoiceGuideRow {
  tone: string;
  reading_level: string;
  do_rules: string[];
  dont_rules: string[];
  prefer_terms: string[];
  avoid_terms: string[];
  notes: string;
}

const EMPTY_GUIDE: VoiceGuide = {
  tone: '',
  reading_level: '',
  do_rules: [],
  dont_rules: [],
  prefer_terms: [],
  avoid_terms: [],
  notes: '',
};

function mapRow(row: VoiceGuideRow): VoiceGuide {
  return {
    tone: row.tone,
    reading_level: row.reading_level,
    do_rules: row.do_rules,
    dont_rules: row.dont_rules,
    prefer_terms: row.prefer_terms,
    avoid_terms: row.avoid_terms,
    notes: row.notes,
  };
}

/** The singleton voice guide. Falls back to an empty guide if the row is somehow absent (e.g. a DB
 *  predating the seed), so callers always get a well-formed object. */
export async function getVoiceGuide(db: Queryable = { query }): Promise<VoiceGuide> {
  const result = await db.query<VoiceGuideRow>(
    `SELECT ${COLUMNS} FROM voice_guide WHERE id = $1`,
    [GUIDE_ID],
  );
  const row = result.rows[0];
  return row === undefined ? EMPTY_GUIDE : mapRow(row);
}

/** Update the singleton guide in place and return the saved value. Upserts so a DB missing the
 *  seeded row still converges to one guide. */
export async function updateVoiceGuide(
  input: VoiceGuideInput,
  db: Queryable = { query },
): Promise<VoiceGuide> {
  const result = await db.query<VoiceGuideRow>(
    `INSERT INTO voice_guide
        (id, tone, reading_level, do_rules, dont_rules, prefer_terms, avoid_terms, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (id) DO UPDATE
        SET tone = EXCLUDED.tone,
            reading_level = EXCLUDED.reading_level,
            do_rules = EXCLUDED.do_rules,
            dont_rules = EXCLUDED.dont_rules,
            prefer_terms = EXCLUDED.prefer_terms,
            avoid_terms = EXCLUDED.avoid_terms,
            notes = EXCLUDED.notes,
            updated_at = now()
     RETURNING ${COLUMNS}`,
    [
      GUIDE_ID,
      input.tone,
      input.reading_level,
      input.do_rules,
      input.dont_rules,
      input.prefer_terms,
      input.avoid_terms,
      input.notes,
    ],
  );
  return mapRow(result.rows[0]!);
}
