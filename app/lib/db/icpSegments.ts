// icp_segments repository (migration 0025) — the canonical "who we market to" config. Typed
// reads/writes for the /settings UI and the worker's voice-context grounding. All queries are
// parameterised; arrays bind/read as native Postgres text[].

import { query, type Queryable } from '@/app/lib/aurora.ts';
import {
  slugifyIcpId,
  type IcpInput,
  type IcpSegment,
  type IcpStatus,
} from '@/app/lib/brandBrain.ts';

interface IcpRow {
  id: string;
  name: string;
  description: string;
  buyer_roles: string[];
  pain_points: string[];
  objections: string[];
  approved_angles: string[];
  status: string;
}

const COLUMNS =
  'id, name, description, buyer_roles, pain_points, objections, approved_angles, status';

function asStatus(value: string): IcpStatus {
  return value === 'archived' ? 'archived' : 'active';
}

function mapRow(row: IcpRow): IcpSegment {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    buyer_roles: row.buyer_roles ?? [],
    pain_points: row.pain_points ?? [],
    objections: row.objections ?? [],
    approved_angles: row.approved_angles ?? [],
    status: asStatus(row.status),
  };
}

export async function listIcpSegments(): Promise<readonly IcpSegment[]> {
  const result = await query<IcpRow>(
    `SELECT ${COLUMNS} FROM icp_segments ORDER BY status, name`,
  );
  return result.rows.map(mapRow);
}

/** Active segments only — what generation grounds against. */
export async function listActiveIcpSegments(): Promise<readonly IcpSegment[]> {
  const result = await query<IcpRow>(
    `SELECT ${COLUMNS} FROM icp_segments WHERE status = 'active' ORDER BY name`,
  );
  return result.rows.map(mapRow);
}

/** Create (or upsert by derived slug id) a segment. Returns the stored row. */
export async function createIcpSegment(
  input: IcpInput,
  db: Queryable = { query },
): Promise<IcpSegment> {
  const id = slugifyIcpId(input.name);
  const result = await db.query<IcpRow>(
    `INSERT INTO icp_segments
       (id, name, description, buyer_roles, pain_points, objections, approved_angles, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name, description = EXCLUDED.description,
       buyer_roles = EXCLUDED.buyer_roles, pain_points = EXCLUDED.pain_points,
       objections = EXCLUDED.objections, approved_angles = EXCLUDED.approved_angles,
       status = EXCLUDED.status, updated_at = now()
     RETURNING ${COLUMNS}`,
    [
      id,
      input.name,
      input.description,
      input.buyer_roles,
      input.pain_points,
      input.objections,
      input.approved_angles,
      input.status,
    ],
  );
  return mapRow(result.rows[0]!);
}

/** Update an existing segment by id. Returns null if it does not exist. */
export async function updateIcpSegment(
  id: string,
  input: IcpInput,
  db: Queryable = { query },
): Promise<IcpSegment | null> {
  const result = await db.query<IcpRow>(
    `UPDATE icp_segments SET
       name = $2, description = $3, buyer_roles = $4, pain_points = $5,
       objections = $6, approved_angles = $7, status = $8, updated_at = now()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [
      id,
      input.name,
      input.description,
      input.buyer_roles,
      input.pain_points,
      input.objections,
      input.approved_angles,
      input.status,
    ],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function deleteIcpSegment(id: string, db: Queryable = { query }): Promise<void> {
  await db.query('DELETE FROM icp_segments WHERE id = $1', [id]);
}
