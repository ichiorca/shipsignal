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

import psycopg
from langgraph.types import Command

from release_worker.aurora_claims import (
    AuroraArtifactReviewSink,
    AuroraClaimSink,
    AuroraEvidenceMatcher,
)
from release_worker.aurora_content import (
    AuroraApprovedFeatureReader,
    AuroraArtifactSink,
    AuroraSkillSnapshotSink,
)
from release_worker.aurora_evidence import (
    AuroraBoundaryReader,
    S3AuroraEvidenceSink,
    s3_client_from_env,
)
from release_worker.aurora_features import (
    AuroraFeatureSink,
    AuroraRedactedEvidenceReader,
)
from release_worker.aurora_media import AuroraDemoScriptReader, AuroraMediaAssetSink
from release_worker.aurora_repository import (
    AuroraReleaseRunRepository,
    connect_from_env,
)
from release_worker.bedrock_client import BedrockModelClient
from release_worker.content_graph import build_content_generation_graph
from release_worker.content_state import ContentRunState
from release_worker.elevenlabs_client import ElevenLabsSynthesizer
from release_worker.feature_models import GateDecision
from release_worker.ffmpeg_assembler import FfmpegVideoAssembler
from release_worker.github_diff_source import GitHubDiffSource
from release_worker.github_pr_source import GitHubPullRequestSource
from release_worker.graph import build_release_intelligence_graph
from release_worker.guardrails_client import BedrockGuardrailScanner
from release_worker.media_graph import build_media_generation_graph
from release_worker.media_state import MediaRunState
from release_worker.playwright_capture import PlaywrightDemoCapturer
from release_worker.repo_skill_source import FilesystemSkillSource
from release_worker.s3_media_store import S3MediaStore
from release_worker.state import ReleaseRunState

logger = logging.getLogger("release_worker")

_DEFAULT_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"


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
    parser.add_argument(
        "--graph",
        choices=["release_intelligence", "content_generation", "media_generation"],
        default="release_intelligence",
        help="Which graph to run for this release run (default: release_intelligence).",
    )
    return parser.parse_args(argv)


def _run_content_generation(
    conn: psycopg.Connection,
    release_run_id: str,
    thread_id: str,
    dashboard_base_url: str,
    resume_decision: str | None,
) -> int:
    """Run content_generation_graph for one run through Gate #2 (spec 005/006, PRD §5.3).

    load approved features → snapshot skills → generate blog+changelog → extract claims →
    link claims to evidence → deterministic checks → Bedrock Guardrails → persist drafts +
    claims → HALT at the Gate #2 interrupt. The run's repo is read from ``release_runs`` so
    skill snapshots are scoped correctly (skills are repo-level, §10.5). The graph fails
    closed if no features are approved (constitution §5).

    Two modes mirror the release graph: an initial run halts at Gate #2; a ``--resume-decision``
    continues the SAME ``thread_id`` past the interrupt (PRD §5.6). Cross-process resume needs
    a durable checkpointer (the bundled ``MemorySaver`` is process-local).
    """
    with conn.cursor() as cur:
        cur.execute("SELECT repo FROM release_runs WHERE id = %s", (release_run_id,))
        row = cur.fetchone()
    if row is None:
        raise RuntimeError(f"release run {release_run_id} not found")
    repo = row[0]

    graph = build_content_generation_graph(
        AuroraApprovedFeatureReader(conn),
        FilesystemSkillSource.from_env(),
        AuroraSkillSnapshotSink(conn),
        BedrockModelClient.from_env(),
        AuroraArtifactSink(conn),
        AuroraEvidenceMatcher(conn, release_run_id),
        BedrockGuardrailScanner.from_env(),
        AuroraClaimSink(conn),
        AuroraArtifactReviewSink(conn),
        model_id=os.environ.get("BEDROCK_MODEL_ID", _DEFAULT_MODEL_ID),
        dashboard_base_url=dashboard_base_url,
    )
    config = {"configurable": {"thread_id": thread_id}}

    if resume_decision is not None:
        # Continue the halted graph past Gate #2 with the recorded human decision.
        graph.invoke(Command(resume=resume_decision), config)
        logger.info(
            "content run %s resumed at Gate #2 (%s)", release_run_id, resume_decision
        )
        return 0

    initial = ContentRunState(
        release_run_id=release_run_id, thread_id=thread_id, repo=repo
    )
    result = graph.invoke(initial, config)
    if "__interrupt__" in result:
        logger.info(
            "content run %s halted at Gate #2 (thread %s); awaiting review",
            release_run_id,
            thread_id,
        )
    else:
        logger.info("content run %s completed (thread %s)", release_run_id, thread_id)
    return 0


def _run_media_generation(
    conn: psycopg.Connection,
    release_run_id: str,
    thread_id: str,
) -> int:
    """Run media_generation_graph for one run (spec 008, PRD §5.4).

    load approved demo_script → generate click-path → STRICT-validate it → Playwright capture
    (synthetic fixture data) → ElevenLabs narration (content-hash idempotent, stubbed in CI) →
    ffmpeg assemble (only after audio materialized) → store in S3 (private, sanitized key) →
    persist the media_assets row. There is no human gate in this graph — its demo_script input
    is already Gate#2-approved — so it runs straight through. The run fails closed if no
    demo_script is approved (constitution §5). All capture/narration/assembly runs on the
    Actions runner (constitution §1), never the Vercel app.

    The narration voice/model/output-format are read from env as CONFIG (elevenlabs-rules), not
    hardcoded. The media id is minted per run (P1: we record provenance, LangGraph owns state).
    """
    media_id = uuid4().hex
    graph = build_media_generation_graph(
        AuroraDemoScriptReader(conn),
        BedrockModelClient.from_env(),
        PlaywrightDemoCapturer.from_env(),
        ElevenLabsSynthesizer.from_env(),
        FfmpegVideoAssembler.from_env(),
        S3MediaStore(s3_client_from_env(), _require_env("MEDIA_BUCKET")),
        AuroraMediaAssetSink(conn),
    )
    config = {"configurable": {"thread_id": thread_id}}
    initial = MediaRunState(
        release_run_id=release_run_id,
        thread_id=thread_id,
        media_id=media_id,
        voice_id=_require_env("ELEVENLABS_VOICE_ID"),
        model_id=os.environ.get("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2"),
        output_format=os.environ.get("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128"),
    )
    graph.invoke(initial, config)
    logger.info("media run %s completed (thread %s)", release_run_id, thread_id)
    return 0


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
        if args.graph == "content_generation":
            # Spec 005/006 slice: generate drafts → claims → checks → Gate #2 interrupt.
            # Initial run halts at Gate #2; --resume-decision continues the same thread.
            return _run_content_generation(
                conn,
                release_run_id,
                thread_id,
                dashboard_base_url,
                args.resume_decision,
            )

        if args.graph == "media_generation":
            # Spec 008 slice: approved demo_script → validated click-path → Playwright capture
            # → ElevenLabs narration → ffmpeg → S3 → media_assets. No human gate (the script is
            # already Gate#2-approved); runs straight through on the Actions runner.
            return _run_media_generation(conn, release_run_id, thread_id)

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
