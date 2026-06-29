"""Print an Amazon Aurora PostgreSQL usage proof (for the hackathon submission screenshot).

Run:  DATABASE_URL=postgresql://... python scripts/aurora_proof.py
Outputs engine/version, pgvector status, migration head, table + row counts, and proof points.
No secrets are printed.
"""

from __future__ import annotations

import os
import sys

import psycopg


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("DATABASE_URL is required", file=sys.stderr)
        return 2
    if "sslmode=" not in dsn:
        dsn += ("&" if "?" in dsn else "?") + "sslmode=require"

    c = psycopg.connect(dsn, autocommit=True)
    cur = c.cursor()

    def one(q: str) -> object:
        cur.execute(q)
        return cur.fetchone()[0]

    print("=" * 78)
    print(" ShipSignal -- Amazon Aurora PostgreSQL (Serverless v2)")
    print("=" * 78)
    cur.execute("select version()")
    print("engine:", cur.fetchone()[0].split(",")[0])
    print(
        "pgvector:",
        "installed"
        if one("select count(*) from pg_extension where extname='vector'")
        else "absent",
    )
    print("schema migration head:", one("select version_num from alembic_version"))
    print(
        "tables in public schema:",
        one(
            "select count(*) from information_schema.tables where table_schema='public'"
        ),
    )
    print("-" * 78)
    print(" row counts")
    for t in [
        "release_runs",
        "evidence_items",
        "feature_clusters",
        "artifacts",
        "artifact_claims",
        "skills",
        "capability_skills",
        "agent_capabilities",
        "learning_signals",
        "skill_revision_candidates",
        "media_assets",
        "eval_runs",
        "connections",
    ]:
        print(f"   {t:30} {one(f'select count(*) from {t}'):>7}")
    print(
        f"   {'evidence_items WITH embedding':30} {one('select count(*) from evidence_items where embedding is not null'):>7}"
    )
    print("-" * 78)
    print(" proof points")
    print(
        "   brand-voice skill version       ",
        one("select current_version from skills where name='brand-voice'"),
    )
    print(
        "   promoted skill candidates       ",
        one("select count(*) from skill_revision_candidates where status='promoted'"),
    )
    print(
        "   demo videos published to YouTube",
        one("select count(*) from media_assets where external_platform='youtube'"),
    )
    print(
        "   LLM-as-judge rubric scores      ",
        one("select count(*) from eval_runs where eval_type='rubric'"),
    )
    print("=" * 78)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
