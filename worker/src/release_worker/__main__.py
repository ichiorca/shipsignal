"""T5 (spec 001) / T2-T4 (spec 002) / T2-T4,T6 (spec 004) — Actions release-run entry.

Wires the durable Aurora repository plus every port (Aurora boundary reader, GitHub
diff/PR sources, S3+Aurora evidence sink, redacted-evidence reader, Bedrock model
client, Aurora feature sink) into ``release_intelligence_graph`` and runs it for one
``release_run_id``: collect → redact → persist evidence, cluster → score → persist the
feature manifest, then HALT at the Gate #1 interrupt.

P5 (Safety rails): the run id (+ optional resume decision) are the only externally
supplied values and are validated before use; the DB DSN, GitHub token, S3 bucket, and
Bedrock model/guardrail ids all come from env, never argv. On any failure the run is
marked ``failed`` so the dashboard never shows a run wedged mid-flight.

Two modes:
* initial — no ``--resume-decision``: run to the gate. The graph blocks at
  ``approve_feature_manifest`` (constitution §5: no self-approval); features are left
  ``pending_review`` and the process exits 0 with the run awaiting a human at Gate #1.
* resume — ``--resume-decision {approved|rejected|edited}``: continue the SAME
  ``thread_id`` past the gate (PRD §5.6 "resume the same thread_id"). Requires a durable
  checkpointer in production (a Postgres saver); the bundled default ``MemorySaver`` is
  process-local, so cross-process resume must inject one — see ``build_release_intelligence_graph``.

This module owns the runtime adapters (psycopg/boto3/langgraph) so the unit gate never
imports them — it tests the pure node logic against in-memory fakes instead.

Invoked as ``python -m release_worker --release-run-id <uuid> [--resume-decision <d>]
[--thread-id <id>]`` on the runner.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from uuid import uuid4

from langgraph.types import Command

from release_worker.aurora_evidence import (
    AuroraBoundaryReader,
    S3AuroraEvidenceSink,
    s3_client_from_env,
)
from release_worker.aurora_features import (
    AuroraFeatureSink,
    AuroraRedactedEvidenceReader,
)
from release_worker.aurora_repository import (
    AuroraReleaseRunRepository,
    connect_from_env,
)
from release_worker.bedrock_client import BedrockModelClient
from release_worker.feature_models import GateDecision
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
    parser.add_argument(
        "--resume-decision",
        choices=[d.value for d in GateDecision],
        default=None,
        help="Resume a run halted at Gate #1 with a recorded human decision.",
    )
    parser.add_argument(
        "--thread-id",
        default=None,
        help="LangGraph thread to resume (required with --resume-decision).",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    release_run_id = args.release_run_id

    # Resume reuses the caller-supplied thread (PRD §5.6 "resume the same thread_id");
    # an initial run mints one (P1: LangGraph owns the thread; we record it on the run).
    thread_id = args.thread_id or f"lg_{uuid4().hex}"
    dashboard_base_url = os.environ.get("DASHBOARD_BASE_URL", "https://app.example.com")

    # One shared connection for the whole short-lived job (aurora-postgresql-rules).
    conn = connect_from_env()
    repository = AuroraReleaseRunRepository(conn)
    try:
        graph = build_release_intelligence_graph(
            repository,
            AuroraBoundaryReader(conn),
            GitHubDiffSource.from_env(),
            GitHubPullRequestSource.from_env(),
            S3AuroraEvidenceSink(
                conn, s3_client_from_env(), _require_env("EVIDENCE_BUCKET")
            ),
            AuroraRedactedEvidenceReader(conn),
            BedrockModelClient.from_env(),
            AuroraFeatureSink(conn),
            dashboard_base_url=dashboard_base_url,
        )
        config = {"configurable": {"thread_id": thread_id}}

        if args.resume_decision is not None:
            # Continue the halted graph past Gate #1 with the recorded human decision.
            graph.invoke(Command(resume=args.resume_decision), config)
            logger.info(
                "release run %s resumed (%s)", release_run_id, args.resume_decision
            )
            return 0

        initial = ReleaseRunState(release_run_id=release_run_id, thread_id=thread_id)
        result = graph.invoke(initial, config)
        if "__interrupt__" in result:
            logger.info(
                "release run %s halted at Gate #1 (thread %s); awaiting review",
                release_run_id,
                thread_id,
            )
        else:
            logger.info(
                "release run %s completed (thread %s)", release_run_id, thread_id
            )
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
