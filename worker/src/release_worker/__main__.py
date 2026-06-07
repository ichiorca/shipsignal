"""T5 (spec 001) / T2-T4 (spec 002) — entry point the Actions release-run job invokes.

Wires the durable Aurora repository plus the evidence ports (Aurora boundary reader,
GitHub diff source, S3+Aurora evidence sink) into ``release_intelligence_graph`` and
runs it for one ``release_run_id``: collect -> redact -> persist evidence, then advance
the run to completed. P5 (Safety rails): the run id is the only externally supplied
value and is validated before use; the DB DSN, GitHub token, and S3 bucket all come
from env, never argv. On any failure the run is marked ``failed`` so the dashboard
never shows a run wedged in ``running``.

This module owns the runtime adapters (psycopg/boto3/urllib) so the unit gate never
imports them — it tests the pure node logic against in-memory fakes instead.

Invoked as ``python -m release_worker --release-run-id <uuid>`` on the runner.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from uuid import uuid4

from release_worker.aurora_evidence import (
    AuroraBoundaryReader,
    S3AuroraEvidenceSink,
    s3_client_from_env,
)
from release_worker.aurora_repository import (
    AuroraReleaseRunRepository,
    connect_from_env,
)
from release_worker.github_diff_source import GitHubDiffSource
from release_worker.github_pr_source import GitHubPullRequestSource
from release_worker.graph import build_release_intelligence_graph
from release_worker.state import ReleaseRunState

logger = logging.getLogger("release_worker")


def _require_env(name: str) -> str:
    """Read a required env var or fail fast with a secret-free message."""
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="release_worker")
    parser.add_argument(
        "--release-run-id",
        required=True,
        help="UUID of the pre-inserted release_runs row to advance.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    release_run_id = args.release_run_id

    # The langgraph thread id we persist back to the run (P1: LangGraph owns the
    # thread; the skeleton mints one and records it per the AC).
    thread_id = f"lg_{uuid4().hex}"

    # One shared connection for the whole short-lived job (aurora-postgresql-rules):
    # the run repository, the boundary reader, and the evidence sink all use it.
    conn = connect_from_env()
    repository = AuroraReleaseRunRepository(conn)
    try:
        boundary_reader = AuroraBoundaryReader(conn)
        diff_source = GitHubDiffSource.from_env()
        pr_source = GitHubPullRequestSource.from_env()
        evidence_sink = S3AuroraEvidenceSink(
            conn, s3_client_from_env(), _require_env("EVIDENCE_BUCKET")
        )
        graph = build_release_intelligence_graph(
            repository, boundary_reader, diff_source, pr_source, evidence_sink
        )
        initial = ReleaseRunState(release_run_id=release_run_id, thread_id=thread_id)
        graph.invoke(initial)
        logger.info("release run %s completed (thread %s)", release_run_id, thread_id)
        return 0
    except Exception:
        logger.exception("release run %s failed", release_run_id)
        try:
            repository.mark_failed(release_run_id)
        except Exception:
            logger.exception("could not mark release run %s failed", release_run_id)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
