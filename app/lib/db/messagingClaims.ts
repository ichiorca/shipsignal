// messaging_claims repository (migration 0025) — approved, evidence-backed positioning/value-prop
// claims scoped by ICP. Generation injects the approved set for the target ICP; the claim/check
// node can validate a draft's claims against them. All queries parameterised; arrays are text[].

import { query, type Queryable } from '@/app/lib/aurora.ts';
import { isUuid } from '@/app/lib/uuid.ts';
import type {
  MessagingClaim,
  MessagingClaimInput,
  MessagingClaimStatus,
  MessagingClaimType,
} from '@/app/lib/brandBrain.ts';

interface ClaimRow {
  id: string;
  claim_text: string;
  claim_type: string;
  evidence_url: string | null;
  applies_to_icp: string[];
  status: string;
}

const COLUMNS = 'id, claim_text, claim_type, evidence_url, applies_to_icp, status';

function mapRow(row: ClaimRow): MessagingClaim {
  return {
    id: row.id,
    claim_text: row.claim_text,
    claim_type: row.claim_type as MessagingClaimType,
    evidence_url: row.evidence_url,
    applies_to_icp: row.applies_to_icp ?? [],
    status: row.status as MessagingClaimStatus,
  };
}

export async function listMessagingClaims(): Promise<readonly MessagingClaim[]> {
  const result = await query<ClaimRow>(
    `SELECT ${COLUMNS} FROM messaging_claims ORDER BY status, created_at DESC`,
  );
  return result.rows.map(mapRow);
}

/** Approved claims for a set of ICP segment ids — the set generation may use (overlap on
 *  applies_to_icp). An empty `icpIds` returns claims that apply to every ICP (empty applies_to). */
export async function listApprovedClaimsForIcps(
  icpIds: readonly string[],
): Promise<readonly MessagingClaim[]> {
  const result = await query<ClaimRow>(
    `SELECT ${COLUMNS} FROM messaging_claims
      WHERE status = 'approved'
        AND (cardinality(applies_to_icp) = 0 OR applies_to_icp && $1::text[])
      ORDER BY created_at DESC`,
    [[...icpIds]],
  );
  return result.rows.map(mapRow);
}

export async function createMessagingClaim(
  input: MessagingClaimInput,
  db: Queryable = { query },
): Promise<MessagingClaim> {
  const result = await db.query<ClaimRow>(
    `INSERT INTO messaging_claims (claim_text, claim_type, evidence_url, applies_to_icp, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [
      input.claim_text,
      input.claim_type,
      input.evidence_url && input.evidence_url !== '' ? input.evidence_url : null,
      input.applies_to_icp,
      input.status,
    ],
  );
  return mapRow(result.rows[0]!);
}

export async function updateMessagingClaim(
  id: string,
  input: MessagingClaimInput,
  db: Queryable = { query },
): Promise<MessagingClaim | null> {
  if (!isUuid(id)) return null;
  const result = await db.query<ClaimRow>(
    `UPDATE messaging_claims SET
       claim_text = $2, claim_type = $3, evidence_url = $4, applies_to_icp = $5,
       status = $6, updated_at = now()
     WHERE id = $1
     RETURNING ${COLUMNS}`,
    [
      id,
      input.claim_text,
      input.claim_type,
      input.evidence_url && input.evidence_url !== '' ? input.evidence_url : null,
      input.applies_to_icp,
      input.status,
    ],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function deleteMessagingClaim(
  id: string,
  db: Queryable = { query },
): Promise<boolean> {
  if (!isUuid(id)) return false;
  const result = await db.query('DELETE FROM messaging_claims WHERE id = $1', [id]);
  return (result.rowCount ?? 0) > 0;
}
