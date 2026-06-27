"""Generate (and optionally promote) a real skill-evolution suggestion for the dashboard demo.

Mirrors ``seed_demo_run.py`` for the skill-learning loop: runs the REAL skill-learning nodes against
the configured Aurora, using the offline ``DemoModelClient`` for the one LLM step (the skill-revision
draft — Bedrock is account-held). It mines representative reviewer feedback for a chosen skill,
clusters it, drafts a next-version SKILL.md *suggestion*, and persists it ``status='draft'`` so it
appears on the dashboard:

  - /skills                          -> the suggestion in the candidate queue
  - /releases/<run>/skills/review    -> Gate #3, where a human promotes or rejects it

With ``--promote`` it also performs the human-gated promotion offline: layer-3 safety scan ->
publish the NEXT skill version to the ``skills`` table (DB-as-source-of-truth) -> overwrite the repo
``SKILL.md`` -> record the promotion provenance (commit sha + old/new content hashes). The repo file
write is real and revertable with git.

REAL: Aurora reads/writes, the active skill body, clustering, the versioned-store publish, the
provenance record. DEMO: the LLM-drafted body (representative, a de-hyped revision of the current
body) and — under ``--promote`` — a permissive offline guardrail stand-in (the deterministic
named-entity policy checks still run). Flip in Bedrock and the same nodes run live.

Env:
  DATABASE_URL          Postgres DSN (plain postgresql:// form)
  DASHBOARD_BASE_URL    for the printed review links (default https://shipsignal-xi.vercel.app)
  SKILLS_ROOT           skills dir (default <repo>/skills); GITHUB_SHA stamped as the commit sha

Usage:
  python scripts/seed_skill_evolution_demo.py                         # generate a draft suggestion
  python scripts/seed_skill_evolution_demo.py --promote               # generate + publish next ver
  python scripts/seed_skill_evolution_demo.py --skill brand-voice --release-run-id <uuid> --promote
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from uuid import uuid4

import psycopg

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "worker" / "src"))

from release_worker.aurora_skill_learning import (
    AuroraLearningSignalSink,
    AuroraRepoActiveSkillReader,
    AuroraSkillCandidateSink,
    AuroraSuppressionStore,
)
from release_worker.aurora_skill_writer import DbBackedRepoSkillWriter
from release_worker.claim_ports import InMemoryGuardrailScanner
from release_worker.content_policy import load_named_entity_policy
from release_worker.demo_model_client import DemoModelClient
from release_worker.repo_skill_writer import FilesystemRepoSkillWriter
from release_worker.skill_learning_models import (
    RawReviewSignal,
    SkillGateResolution,
    SkillRevisionCandidate,
)
from release_worker.skill_learning_nodes import (
    cluster_edit_patterns,
    cluster_rejection_patterns,
    collect_learning_signals,
    draft_skill_revision_candidate,
    mark_candidate_promoted,
    persist_candidate_in_aurora,
    prevent_unsafe_promotion,
    select_impacted_skills,
    update_repo_skill_file,
)
from release_worker.skill_learning_ports import InMemoryLearningSignalSource


def _active_snapshot(
    conn: psycopg.Connection, skill_name: str
) -> tuple[str, str] | None:
    """The latest active (snapshot_id, skill_path) for a skill, or None if it isn't seeded."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, skill_path
              FROM skill_repo_snapshots
             WHERE skill_name = %s AND is_active
             ORDER BY synced_at DESC
             LIMIT 1
            """,
            (skill_name,),
        )
        row = cur.fetchone()
    return (str(row[0]), str(row[1])) if row else None


def _resolve_run(conn: psycopg.Connection, given: str | None) -> str:
    """Use the given run id, else the most recent release run, else create a minimal one."""
    if given:
        return given
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM release_runs ORDER BY started_at DESC LIMIT 1")
        row = cur.fetchone()
        if row:
            return str(row[0])
        run_id = str(uuid4())
        cur.execute(
            "INSERT INTO release_runs (id, repo, base_ref, head_ref, trigger_type, status) "
            "VALUES (%s, 'demo/skill-evolution', 'v0', 'v1', 'manual', 'created')",
            (run_id,),
        )
    return run_id


def _reviewer_signals(snapshot_id: str) -> tuple[RawReviewSignal, ...]:
    """Representative reviewer feedback attributed to the chosen skill's active snapshot: two edits
    (reduce hype, drop an unsupported metric) and a rejected unsupported-metric claim."""
    return (
        RawReviewSignal(
            signal_type="reviewer_edit",
            artifact_id=None,
            source_text="This is the best ever release and it is seamless.\nIt ships today.",
            revised_text="This is a solid release.\nIt ships today.",
            reviewer="demo-reviewer",
            related_skill_snapshot_ids=(snapshot_id,),
        ),
        RawReviewSignal(
            signal_type="reviewer_edit",
            artifact_id=None,
            source_text="Cuts onboarding time by 50%.\nUsers love it.",
            revised_text="Cuts onboarding time.\nUsers love it.",
            reviewer="demo-reviewer",
            related_skill_snapshot_ids=(snapshot_id,),
        ),
        RawReviewSignal(
            signal_type="rejected_claim",
            artifact_id=None,
            source_text="It reduces setup time by 50% for every team.",
            rejection_category="unsupported_metric",
            severity="high",
            related_skill_snapshot_ids=(snapshot_id,),
        ),
    )


def _load_latest_draft(
    conn: psycopg.Connection, skill_name: str
) -> SkillRevisionCandidate | None:
    """Reconstruct the most recent DRAFT candidate for a skill from Aurora, so an already-staged
    suggestion (the one a reviewer sees on screen) can be promoted without re-drafting a duplicate."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, repo, skill_name, skill_path, base_skill_snapshot_id, proposed_version,
                   proposed_body, proposed_frontmatter_json, proposal_reason, miner_type,
                   supporting_signal_ids, confidence, pattern_hash, old_content_hash, status
              FROM skill_revision_candidates
             WHERE skill_name = %s AND status = 'draft'
             ORDER BY created_at DESC
             LIMIT 1
            """,
            (skill_name,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return SkillRevisionCandidate(
        candidate_id=str(row[0]),
        repo=row[1],
        skill_name=row[2],
        skill_path=row[3],
        base_skill_snapshot_id=str(row[4]) if row[4] else None,
        proposed_version=row[5],
        proposed_body=row[6],
        proposed_frontmatter=row[7] or {},
        proposal_reason=row[8],
        miner_type=row[9],
        supporting_signal_ids=tuple(str(s) for s in (row[10] or ())),
        confidence=float(row[11]) if row[11] is not None else 0.0,
        pattern_hash=row[12],
        old_content_hash=row[13],
        status=row[14],
    )


def _promote(
    conn: psycopg.Connection,
    candidates: tuple[SkillRevisionCandidate, ...],
    candidate_sink: AuroraSkillCandidateSink,
    reviewer: str,
    dashboard: str,
) -> None:
    """Human-gated promotion (offline): layer-3 safety scan -> publish next version (skills table) +
    overwrite the repo SKILL.md + record provenance. Permissive guardrail stand-in; the deterministic
    named-entity policy still runs."""
    safe = prevent_unsafe_promotion(
        candidates, InMemoryGuardrailScanner(), load_named_entity_policy()
    )
    commit_sha = os.environ.get("GITHUB_SHA") or f"demo-{uuid4().hex[:12]}"
    writer = DbBackedRepoSkillWriter(
        conn, FilesystemRepoSkillWriter(_REPO_ROOT / "skills", commit_sha)
    )
    records = update_repo_skill_file(
        safe, SkillGateResolution(decision="approved", reviewer=reviewer), writer
    )
    mark_candidate_promoted(records, candidate_sink)
    for r, c in zip(records, safe, strict=False):
        print(
            f"\npromoted {c.skill_name} -> v{c.proposed_version}\n"
            f"  candidate {c.candidate_id}\n"
            f"  commit {r.promoted_commit_sha}\n"
            f"  old hash {r.old_content_hash}\n  new hash {r.new_content_hash}\n"
            f"  file {c.skill_path} overwritten (revert with: git checkout -- {c.skill_path})"
        )
    print(f"\npublished — see {dashboard}/skills and {dashboard}/learning")


def main() -> int:
    # Windows consoles default to cp1252; force UTF-8 so help text/output never crash on encode.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skill", default="brand-voice", help="skill to evolve")
    parser.add_argument(
        "--release-run-id", default=None, help="run to attach signals to"
    )
    parser.add_argument("--reviewer", default="demo-operator")
    parser.add_argument(
        "--promote",
        action="store_true",
        help="also promote the freshly-drafted suggestion (publish the next version)",
    )
    parser.add_argument(
        "--promote-existing",
        action="store_true",
        help="promote the latest existing DRAFT candidate for --skill (no new draft)",
    )
    args = parser.parse_args()

    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2
    if "sslmode=" not in dsn:
        dsn += ("&" if "?" in dsn else "?") + "sslmode=require"

    # _safe_target resolves skill paths against the cwd; run rooted at the repo so the SKILL.md
    # write lands in the checked-out skills/ tree.
    os.chdir(_REPO_ROOT)
    dashboard = os.environ.get("DASHBOARD_BASE_URL", "https://shipsignal-xi.vercel.app")

    conn = psycopg.connect(dsn, autocommit=True)
    snapshot = _active_snapshot(conn, args.skill)
    if snapshot is None:
        print(
            f"no active snapshot for skill '{args.skill}' — run seed_reference_skills.py first",
            file=sys.stderr,
        )
        return 1
    candidate_sink = AuroraSkillCandidateSink(conn)

    # Promote an already-staged suggestion (the one a reviewer sees) without re-drafting.
    if args.promote_existing:
        existing = _load_latest_draft(conn, args.skill)
        if existing is None:
            print(
                f"no draft candidate for '{args.skill}' to promote — generate one first "
                f"(run without --promote-existing)",
                file=sys.stderr,
            )
            return 1
        print(
            f"promoting existing draft {existing.candidate_id} ({existing.skill_name})"
        )
        _promote(conn, (existing,), candidate_sink, args.reviewer, dashboard)
        return 0

    snapshot_id, skill_path = snapshot
    run_id = _resolve_run(conn, args.release_run_id)
    print(f"run {run_id}  skill '{args.skill}' ({skill_path}) snapshot {snapshot_id}")

    # 1) Mine + persist reviewer signals (real learning_signals rows, scoped to the run).
    signals = collect_learning_signals(
        run_id,
        InMemoryLearningSignalSource(_reviewer_signals(snapshot_id)),
        AuroraLearningSignalSink(conn),
        lambda: str(uuid4()),
    )
    print(f"  mined {len(signals)} learning signals")

    # 2) Cluster -> select impacted skills (against the REAL active skill body) -> draft a suggestion.
    clusters = cluster_edit_patterns(signals) + cluster_rejection_patterns(signals)
    impacted = select_impacted_skills(
        clusters, AuroraRepoActiveSkillReader(conn, _REPO_ROOT)
    )
    if not impacted:
        print("  no impacted skill resolved (snapshot/file mismatch); nothing to draft")
        return 1
    candidates = draft_skill_revision_candidate(
        impacted,
        DemoModelClient(),
        AuroraSuppressionStore(conn),
        lambda: str(uuid4()),
    )
    if not candidates:
        print(
            "  suggestion suppressed (cooldown from a recent rejection) — nothing drafted"
        )
        return 0
    persist_candidate_in_aurora(candidates, candidate_sink)
    for c in candidates:
        print(
            f"  drafted candidate {c.candidate_id}: {c.skill_name} "
            f"-> v{c.proposed_version}  (confidence {c.confidence:.2f})"
        )
    print(
        f"\nreview it:\n  {dashboard}/skills\n  {dashboard}/releases/{run_id}/skills/review"
    )

    if not args.promote:
        print("\n(run again with --promote to publish the next version)")
        return 0

    # 3) Promote the freshly-drafted suggestion.
    _promote(conn, candidates, candidate_sink, args.reviewer, dashboard)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
