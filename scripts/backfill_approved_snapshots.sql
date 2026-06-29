-- Backfill the §18.3 approved-content snapshot for artifacts that are status='approved'
-- but have NO row in approved_artifact_snapshots.
--
-- Why: the Gate #2 approve route writes the snapshot + approval + status flip in one
-- transaction, so UI-approved artifacts always have a snapshot. The demo SEED scripts
-- (seed_orcaqubits_nova.py, seed_demo_run.py) flip artifacts straight to 'approved' with raw
-- SQL and never create the snapshot. Export/distribution read ONLY the snapshot, so those
-- seeded artifacts return a confusing 409 from GET /api/artifacts/{id}/export
-- ("artifact is not approved" while status:"approved"). This materialises the missing rows.
--
-- It reproduces app/lib/approvedSnapshot.ts::buildApprovedSnapshot exactly:
--   * content_hash = sha256( coalesce(title,'') || E'\n\n' || coalesce(body,'') )  -- same as
--     migration 0015 / contentHash.ts / content_hash.py
--   * evidence_ids_json = distinct, sorted evidence ids across the artifact's claims
--   * claim_support_json = {claim_id, support_status, risk_level} per claim
--   * approval_id/reviewer reuse the recorded approvals row when one exists; seeded artifacts
--     have none, so approval_id stays NULL and reviewer is the marker 'seed-backfill'.
--
-- Idempotent: the NOT EXISTS filter + ON CONFLICT (artifact_id) DO NOTHING make re-runs safe.
-- No psql variables — nothing to prompt for.
--
-- USAGE (run with psql against the SAME Aurora the Vercel app reads):
--   PREVIEW (read-only, safe):  psql "$DATABASE_URL" -f scripts/backfill_approved_snapshots.sql
--                               -> the SELECT prints the targets; the INSERT writes them.
--   To DRY-RUN the write too:   change the final  COMMIT;  to  ROLLBACK;  and re-run.
--   To SCOPE to one run:        uncomment the two marked AND a.release_run_id = '...' lines.

-- digest() lives in pgcrypto (already enabled by migration 0015); idempotent + safe to re-assert.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- PREVIEW: the approved artifacts missing a snapshot (and their claim/evidence counts).
SELECT a.id AS artifact_id,
       a.release_run_id,
       a.artifact_type,
       (SELECT count(*) FROM artifact_claims ac WHERE ac.artifact_id = a.id) AS claims,
       (SELECT count(DISTINCT cel.evidence_item_id)
          FROM claim_evidence_links cel
          JOIN artifact_claims ac ON ac.id = cel.claim_id
         WHERE ac.artifact_id = a.id) AS evidence_ids
  FROM artifacts a
 WHERE a.status = 'approved'
   AND NOT EXISTS (SELECT 1 FROM approved_artifact_snapshots s WHERE s.artifact_id = a.id)
   -- AND a.release_run_id = '3b1fed7f-eba1-487e-8382-0de8c26a33f3'::uuid   -- scope to one run
 ORDER BY a.created_at;

INSERT INTO approved_artifact_snapshots
    (artifact_id, release_run_id, approval_id, artifact_type, model_id, prompt_version,
     skill_versions_json, evidence_ids_json, claim_support_json, reviewer, reviewer_decision,
     final_title, final_body_markdown, content_hash, generated_at)
SELECT
    a.id,
    a.release_run_id,
    ap.id,                                   -- approval_id (NULL for seeded artifacts)
    a.artifact_type,
    a.model_id,
    a.prompt_version,
    COALESCE(a.skill_versions_json, '{}'::jsonb),
    -- evidence_ids_json: distinct + sorted, matching collectEvidenceIds()
    COALESCE((
        SELECT jsonb_agg(eid ORDER BY eid)
          FROM (
            SELECT DISTINCT cel.evidence_item_id::text AS eid
              FROM claim_evidence_links cel
              JOIN artifact_claims ac ON ac.id = cel.claim_id
             WHERE ac.artifact_id = a.id
          ) e
    ), '[]'::jsonb),
    -- claim_support_json: one object per claim, stable order
    COALESCE((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'claim_id', ac.id::text,
                   'support_status', ac.support_status,
                   'risk_level', ac.risk_level
                 ) ORDER BY ac.id)
          FROM artifact_claims ac
         WHERE ac.artifact_id = a.id
    ), '[]'::jsonb),
    COALESCE(ap.reviewer, 'seed-backfill'),   -- never falsely attribute to a real person
    'approved',
    a.title,
    COALESCE(a.body_markdown, ''),
    -- content_hash: identical canonical digest to migration 0015 / contentHash.ts / content_hash.py
    encode(
      digest(COALESCE(a.title, '') || E'\n\n' || COALESCE(a.body_markdown, ''), 'sha256'),
      'hex'
    ),
    a.created_at
  FROM artifacts a
  LEFT JOIN LATERAL (
        SELECT appr.id, appr.reviewer
          FROM approvals appr
         WHERE appr.target_type = 'artifact'
           AND appr.target_id = a.id
           AND appr.decision = 'approved'
         ORDER BY appr.created_at DESC
         LIMIT 1
  ) ap ON true
 WHERE a.status = 'approved'
   AND NOT EXISTS (SELECT 1 FROM approved_artifact_snapshots s WHERE s.artifact_id = a.id)
   -- AND a.release_run_id = '3b1fed7f-eba1-487e-8382-0de8c26a33f3'::uuid   -- scope to one run
ON CONFLICT (artifact_id) DO NOTHING;

-- Change COMMIT to ROLLBACK to dry-run the INSERT (the PREVIEW SELECT still shows the targets).
COMMIT;
