"""Backfill the §18.3 approved-content snapshot for artifacts that are `status='approved'`
but have no `approved_artifact_snapshots` row.

Why this exists: the Gate #2 approve route
(`app/api/artifacts/[id]/approve/route.ts`) writes the immutable snapshot, the approval
audit row, and the status flip in ONE transaction — so an artifact approved through the UI
always has a snapshot. The demo SEED scripts (`seed_orcaqubits_nova.py`,
`seed_demo_run.py`) instead flip artifacts straight to `approved` with raw SQL and never
create the snapshot. Because the export/distribution surfaces read ONLY the snapshot, those
seeded artifacts return a confusing 409 from
`GET /api/artifacts/{id}/export` ("artifact is not approved" while `status:"approved"`).
This script materialises the missing snapshots so export/distribution work for seeded runs.

It reproduces `app/lib/approvedSnapshot.ts::buildApprovedSnapshot` exactly: the canonical
content hash `sha256(title + "\n\n" + body)`, distinct+sorted evidence ids, and the
per-claim support projection. Idempotent (a `NOT EXISTS` filter plus
`ON CONFLICT (artifact_id) DO NOTHING`), so it is safe to re-run.

SAFETY: defaults to a DRY RUN (reports what it WOULD insert). Pass `--apply` to write.

Run (needs DATABASE_URL + psycopg, `worker/src` on the path — same as the seed scripts):

    PYTHONPATH=worker/src python scripts/backfill_approved_snapshots.py            # dry run
    PYTHONPATH=worker/src python scripts/backfill_approved_snapshots.py --apply
    PYTHONPATH=worker/src python scripts/backfill_approved_snapshots.py \
        --release-run-id 3b1fed7f-eba1-487e-8382-0de8c26a33f3 --apply
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

_REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO_ROOT / "worker" / "src"))

from release_worker.aurora_repository import connect_from_env  # noqa: E402

logger = logging.getLogger("backfill_approved_snapshots")

# Mirror app/lib/contentHash.ts / worker content_hash.py: sha256(title + "\n\n" + body).
_SEPARATOR = "\n\n"


def _content_hash(title: str | None, body_markdown: str) -> str:
    pre_image = f"{title or ''}{_SEPARATOR}{body_markdown}"
    return hashlib.sha256(pre_image.encode("utf-8")).hexdigest()


# Approved artifacts that are missing their immutable snapshot. Optionally scoped to one run.
_MISSING_SQL = """
    SELECT a.id, a.release_run_id, a.artifact_type, a.title, a.body_markdown,
           a.model_id, a.prompt_version, a.skill_versions_json, a.created_at
      FROM artifacts a
     WHERE a.status = 'approved'
       AND NOT EXISTS (
           SELECT 1 FROM approved_artifact_snapshots s WHERE s.artifact_id = a.id
       )
       AND (%(run)s IS NULL OR a.release_run_id = %(run)s)
     ORDER BY a.created_at
"""

# The claims grounding this artifact, in a stable order (matches the snapshot's claim_support).
_CLAIMS_SQL = """
    SELECT id, support_status, risk_level
      FROM artifact_claims
     WHERE artifact_id = %s
     ORDER BY id
"""

# Distinct evidence ids across all of the artifact's claims (collectEvidenceIds, sorted).
_EVIDENCE_SQL = """
    SELECT DISTINCT cel.evidence_item_id::text AS evidence_item_id
      FROM claim_evidence_links cel
      JOIN artifact_claims ac ON ac.id = cel.claim_id
     WHERE ac.artifact_id = %s
     ORDER BY evidence_item_id
"""

# Reuse the recorded human approval when one exists (accurate provenance); seeded artifacts
# have none, so approval_id stays NULL (the FK is nullable) and the reviewer is a clear marker.
_APPROVAL_SQL = """
    SELECT id, reviewer
      FROM approvals
     WHERE target_type = 'artifact' AND target_id = %s AND decision = 'approved'
     ORDER BY created_at DESC
     LIMIT 1
"""

_INSERT_SQL = """
    INSERT INTO approved_artifact_snapshots
        (artifact_id, release_run_id, approval_id, artifact_type, model_id, prompt_version,
         skill_versions_json, evidence_ids_json, claim_support_json, reviewer, reviewer_decision,
         final_title, final_body_markdown, content_hash, generated_at)
    VALUES
        (%(artifact_id)s, %(release_run_id)s, %(approval_id)s, %(artifact_type)s, %(model_id)s,
         %(prompt_version)s, %(skill_versions)s, %(evidence_ids)s, %(claim_support)s, %(reviewer)s,
         %(reviewer_decision)s, %(final_title)s, %(final_body_markdown)s, %(content_hash)s,
         %(generated_at)s)
    ON CONFLICT (artifact_id) DO NOTHING
"""

# Reviewer recorded on a backfilled snapshot that has no approvals row (so it never falsely
# attributes the approval to a person who didn't click the gate).
_BACKFILL_REVIEWER = "seed-backfill"


def _build_params(conn: psycopg.Connection, artifact: dict[str, object]) -> dict[str, object]:
    """Assemble one snapshot row from the approved artifact + its claims/evidence/approval."""
    artifact_id = artifact["id"]
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_CLAIMS_SQL, (artifact_id,))
        claims = cur.fetchall()
        cur.execute(_EVIDENCE_SQL, (artifact_id,))
        evidence_ids = [row["evidence_item_id"] for row in cur.fetchall()]
        cur.execute(_APPROVAL_SQL, (artifact_id,))
        approval = cur.fetchone()

    claim_support = [
        {
            "claim_id": str(c["id"]),
            "support_status": c["support_status"],
            "risk_level": c["risk_level"],
        }
        for c in claims
    ]
    body = artifact["body_markdown"] or ""
    skill_versions = artifact["skill_versions_json"] or {}

    return {
        "artifact_id": artifact_id,
        "release_run_id": artifact["release_run_id"],
        "approval_id": approval["id"] if approval else None,
        "artifact_type": artifact["artifact_type"],
        "model_id": artifact["model_id"],
        "prompt_version": artifact["prompt_version"],
        "skill_versions": Json(skill_versions),
        "evidence_ids": Json(evidence_ids),
        "claim_support": Json(claim_support),
        "reviewer": approval["reviewer"] if approval else _BACKFILL_REVIEWER,
        "reviewer_decision": "approved",
        "final_title": artifact["title"],
        "final_body_markdown": body,
        "content_hash": _content_hash(artifact["title"], body),
        "generated_at": artifact["created_at"],
    }


def backfill(conn: psycopg.Connection, release_run_id: str | None, apply: bool) -> int:
    """Insert the missing snapshots. Returns the number written (or that WOULD be written)."""
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(_MISSING_SQL, {"run": release_run_id})
        missing = cur.fetchall()

    if not missing:
        logger.info("no approved artifacts are missing a snapshot — nothing to backfill")
        return 0

    written = 0
    for artifact in missing:
        params = _build_params(conn, artifact)
        if not apply:
            logger.info(
                "[dry-run] would snapshot artifact %s (type=%s, run=%s, claims=%d, evidence=%d)",
                params["artifact_id"],
                params["artifact_type"],
                params["release_run_id"],
                len(params["claim_support"].obj),
                len(params["evidence_ids"].obj),
            )
            written += 1
            continue
        with conn.cursor() as cur:
            cur.execute(_INSERT_SQL, params)
            # rowcount is 0 if a concurrent writer beat us (ON CONFLICT DO NOTHING) — count real inserts.
            if cur.rowcount:
                written += 1
                logger.info("snapshotted artifact %s", params["artifact_id"])

    return written


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--release-run-id",
        default=None,
        help="Only backfill artifacts of this release run (default: all runs).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write the snapshots. Without this flag the script only reports (dry run).",
    )
    args = parser.parse_args(argv)

    conn = connect_from_env()
    try:
        count = backfill(conn, args.release_run_id, args.apply)
    finally:
        conn.close()

    verb = "inserted" if args.apply else "would insert (dry run; pass --apply to write)"
    logger.info("done: %d snapshot(s) %s", count, verb)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
