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
from pathlib import Path
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
from release_worker.aurora_cost import AuroraCostTelemetrySink
from release_worker.aurora_eval import (
    AuroraApprovedArtifactReader,
    AuroraEvalSink,
    AuroraMetricInputsReader,
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
from release_worker.aurora_skill_learning import (
    AuroraLearningSignalSink,
    AuroraLearningSignalSource,
    AuroraRepoActiveSkillReader,
    AuroraSkillCandidateSink,
    AuroraSuppressionStore,
)
from release_worker.bedrock_client import BedrockEmbeddingClient, BedrockModelClient
from release_worker.checkpointer import build_checkpointer, wants_durable_checkpointer
from release_worker.content_graph import build_content_generation_graph
from release_worker.content_policy import load_named_entity_policy
from release_worker.content_state import ContentRunState
from release_worker.elevenlabs_client import ElevenLabsSynthesizer
from release_worker.eval_orchestration import run_product_evaluation
from release_worker.feature_models import GateDecision
from release_worker.ffmpeg_assembler import FfmpegVideoAssembler
from release_worker.github_diff_source import GitHubDiffSource
from release_worker.github_pr_source import GitHubPullRequestSource
from release_worker.graph import build_release_intelligence_graph
from release_worker.guardrails_client import BedrockGuardrailScanner
from release_worker.log_scrubbing import install_pii_scrubbing
from release_worker.loop_orchestration import phase_from_graph, thread_id_for
from release_worker.media_graph import build_media_generation_graph
from release_worker.media_state import MediaRunState
from release_worker.playwright_capture import PlaywrightDemoCapturer
from release_worker.privacy import main as privacy_main
from release_worker.promotion_config import (
    build_repo_skill_writer,
    parse_promotion_mode,
)
from release_worker.repo_skill_source import FilesystemSkillSource
from release_worker.s3_media_store import S3MediaStore
from release_worker.skill_learning_graph import build_skill_learning_graph
from release_worker.skill_learning_state import SkillLearningState
from release_worker.state import ReleaseRunState
from release_worker.status import RunStatus
from release_worker.transient_retry import with_retries

logger = logging.getLogger("release_worker")

_DEFAULT_MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"
# Placeholder used only when DASHBOARD_BASE_URL is unset — links built from it won't reach the
# real dashboard, so its use is logged as a misconfiguration warning rather than failing silently.
_PLACEHOLDER_DASHBOARD_URL = "https://app.example.com"


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
        "--reviewer",
        default=None,
        help="Reviewer who resolved a gate (recorded on a skill_learning Gate #3 resume).",
    )
    parser.add_argument(
        "--feature-id",
        default=None,
        help=(
            "Approved feature whose demo_script the media graph should render "
            "(spec 014 T1; media_generation only). Omitted = the run's newest approved script."
        ),
    )
    parser.add_argument(
        "--graph",
        choices=[
            "release_intelligence",
            "content_generation",
            "media_generation",
            "skill_learning",
            "eval",
        ],
        default="release_intelligence",
        help="Which graph to run for this release run (default: release_intelligence).",
    )
    return parser.parse_args(argv)


def _finalize_gate2_status(
    repository: AuroraReleaseRunRepository,
    release_run_id: str,
    resume_decision: str,
) -> None:
    """Record the Gate #2 artifact decision on the run lifecycle (T1, spec 015).

    approved → artifacts_approved (optional demo media may follow); rejected → cancelled;
    edited → a re-review is required, so the run stays artifacts_pending_review (the
    advance no-ops). Each hop is validated through the shared status lattice.
    """
    if resume_decision == GateDecision.APPROVED.value:
        repository.advance(release_run_id, RunStatus.ARTIFACTS_APPROVED)
    elif resume_decision == GateDecision.REJECTED.value:
        repository.advance(release_run_id, RunStatus.CANCELLED)
    # EDITED: stays artifacts_pending_review for re-review (no status change).


def _run_content_generation(
    conn: psycopg.Connection,
    repository: AuroraReleaseRunRepository,
    release_run_id: str,
    thread_id: str,
    dashboard_base_url: str,
    resume_decision: str | None,
    embedder: BedrockEmbeddingClient,
    checkpointer: object,
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
        BedrockModelClient.from_env(
            release_run_id=release_run_id,
            telemetry_sink=AuroraCostTelemetrySink(conn),
        ),
        AuroraArtifactSink(conn),
        # T3 (spec 017): inject the embedding seam so claim grounding ranks evidence by the
        # pgvector cosine path (lexical fallback when a run has no embedded rows). PRD §11.
        AuroraEvidenceMatcher(conn, release_run_id, embed_claim=embedder.embed),
        BedrockGuardrailScanner.from_env(),
        AuroraClaimSink(conn),
        AuroraArtifactReviewSink(conn),
        model_id=os.environ.get("BEDROCK_MODEL_ID", _DEFAULT_MODEL_ID),
        dashboard_base_url=dashboard_base_url,
        # T3 (spec 016) — the §18.2 layer-2 named checks use the project-supplied policy
        # (codenames/customer names/internal hostnames), loaded from CONTENT_POLICY_PATH.
        named_entity_policy=load_named_entity_policy(),
        # T1 (spec 017): durable checkpointer so a Gate #2 thread resumes across the separate
        # Actions invocation that records the reviewer's decision (PRD §5.6).
        checkpointer=checkpointer,
    )
    config = {"configurable": {"thread_id": thread_id}}

    if resume_decision is not None:
        # Continue the halted graph past Gate #2 with the recorded human decision. Wrapped
        # in with_retries (spec 012 T2): a transient Bedrock/S3 blip during the post-gate
        # nodes retries the SAME checkpointed thread (idempotent re-entry), never a fork.
        with_retries(
            lambda: graph.invoke(Command(resume=resume_decision), config),
            label=f"content resume {release_run_id}",
        )
        # T1 (spec 015): record the Gate #2 outcome on the run — approved →
        # artifacts_approved (media may follow), rejected → cancelled, edited → no-op.
        _finalize_gate2_status(repository, release_run_id, resume_decision)
        logger.info(
            "content run %s resumed at Gate #2 (%s)", release_run_id, resume_decision
        )
        return 0

    # T1 (spec 015): features_approved → generating_artifacts as the content graph starts.
    repository.advance(release_run_id, RunStatus.GENERATING_ARTIFACTS)
    initial = ContentRunState(
        release_run_id=release_run_id, thread_id=thread_id, repo=repo
    )
    result = with_retries(
        lambda: graph.invoke(initial, config), label=f"content run {release_run_id}"
    )
    if "__interrupt__" in result:
        # Drafts + claims are persisted; the run now awaits Gate #2.
        repository.advance(release_run_id, RunStatus.ARTIFACTS_PENDING_REVIEW)
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
    repository: AuroraReleaseRunRepository,
    release_run_id: str,
    thread_id: str,
    feature_id: str | None,
    checkpointer: object,
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

    spec 014 T1 — ``feature_id`` scopes the demo_script lookup to the approved feature the reviewer
    triggered generate-demo for (None = the run's newest approved script). spec 014 T3 — a media
    step that fails for a non-transient reason no longer fails the whole run opaquely: the graph
    persists a 'broken' media asset naming the step (§16.3); only a genuinely transient blip is
    retried by ``with_retries``.
    """
    media_id = uuid4().hex
    graph = build_media_generation_graph(
        AuroraDemoScriptReader(conn),
        BedrockModelClient.from_env(
            release_run_id=release_run_id,
            telemetry_sink=AuroraCostTelemetrySink(conn),
        ),
        PlaywrightDemoCapturer.from_env(),
        ElevenLabsSynthesizer.from_env(),
        FfmpegVideoAssembler.from_env(),
        S3MediaStore(s3_client_from_env(), _require_env("MEDIA_BUCKET")),
        AuroraMediaAssetSink(conn),
        # T1 (spec 017): durable checkpointer so a transient-retry re-entry resumes the same
        # checkpointed media thread across process boundaries rather than forking (PRD §5.6).
        checkpointer=checkpointer,
    )
    config = {"configurable": {"thread_id": thread_id}}
    # T1 (spec 015): artifacts_approved → generating_media as the media graph starts.
    repository.advance(release_run_id, RunStatus.GENERATING_MEDIA)
    initial = MediaRunState(
        release_run_id=release_run_id,
        thread_id=thread_id,
        media_id=media_id,
        voice_id=_require_env("ELEVENLABS_VOICE_ID"),
        model_id=os.environ.get("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2"),
        output_format=os.environ.get("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128"),
        # spec 014 T1 — scope the demo_script to the feature the reviewer triggered (if any).
        requested_feature_id=feature_id,
    )
    # T2 (spec 012) — the media graph runs straight through (no gate) but touches Bedrock /
    # ElevenLabs / S3; retry the whole invocation on a transient blip. The node-level
    # idempotency (content-hash TTS dedupe, sanitized S3 key) makes re-entry safe.
    result = with_retries(
        lambda: graph.invoke(initial, config), label=f"media run {release_run_id}"
    )
    # spec 014 T3 / §16.3 — demo media is OPTIONAL: a broken step records a 'broken' media asset
    # (surfaced in the dashboard) rather than failing the whole run, so the run still reaches its
    # terminal 'completed' (the mandatory artifact phases already succeeded upstream). But a break
    # must be observable at the run level, not silent — log a warning naming the failed step.
    broken_step = result.get("failed_step") if isinstance(result, dict) else None
    if broken_step:
        logger.warning(
            "media run %s broke at step %s; recorded a broken asset (run completes — demo "
            "media is optional)",
            release_run_id,
            broken_step,
        )
    # T1 (spec 015): media phase done → the run reaches its terminal completed.
    repository.advance(release_run_id, RunStatus.COMPLETED)
    logger.info("media run %s completed (thread %s)", release_run_id, thread_id)
    return 0


def _run_skill_learning(
    conn: psycopg.Connection,
    release_run_id: str,
    thread_id: str,
    dashboard_base_url: str,
    resume_decision: str | None,
    reviewer: str | None,
    checkpointer: object,
) -> int:
    """Run skill_learning_graph for one run through Gate #3 (spec 009, PRD §5.5).

    collect learning signals (reviewer edits / rejected claims / notes) → cluster edit + rejection
    patterns → select impacted skills → draft a staged revision candidate per skill → persist as
    status='draft' → HALT at the Gate #3 interrupt. The run's repo is read from ``release_runs`` so
    candidates are scoped to the right repo (skills are repo-level, §10.5). NO repo SKILL.md is
    written on this path (constitution §5 / AC1) — the file is replaced only on a Gate #3 *approve*
    resume.

    Two modes mirror the other graphs: an initial run halts at Gate #3; a ``--resume-decision``
    continues the SAME ``thread_id`` past the interrupt (PRD §5.6). On *approved* the worker runs
    ``update_repo_skill_file`` → ``mark_candidate_promoted`` (the single repo write + the AC2
    promotion record); on *rejected* it records the rejection + a cooldown suppression. The
    ``--reviewer`` is threaded into the resume so the promotion/rejection record names the human who
    decided (§10.5 reviewed_by). Cross-process resume needs a durable checkpointer (the bundled
    ``MemorySaver`` is process-local).
    """
    with conn.cursor() as cur:
        cur.execute("SELECT repo FROM release_runs WHERE id = %s", (release_run_id,))
        row = cur.fetchone()
    if row is None:
        raise RuntimeError(f"release run {release_run_id} not found")
    repo = row[0]

    graph = build_skill_learning_graph(
        AuroraLearningSignalSource(conn),
        AuroraLearningSignalSink(conn),
        AuroraRepoActiveSkillReader(conn, Path.cwd()),
        BedrockModelClient.from_env(
            release_run_id=release_run_id,
            telemetry_sink=AuroraCostTelemetrySink(conn),
        ),
        AuroraSuppressionStore(conn),
        AuroraSkillCandidateSink(conn),
        # T4 (spec 018) — the repo writer is config-selected (PRD §9.4.4 / §15.3): the preferred
        # PR mode (branch + PR a human merges) or the hackathon-fast direct write to the
        # checked-out tree. Both reach the graph only on the approved Gate #3 branch, so neither
        # relaxes a §9.4 invariant. Default is direct; SKILL_PROMOTION_MODE=pr opts into PR mode.
        build_repo_skill_writer(
            parse_promotion_mode(os.environ.get("SKILL_PROMOTION_MODE"))
        ),
        # T4 (spec 016) — §18.2 layer-3: the proposed skill body is scanned through the SAME
        # published Bedrock Guardrail as artifacts before any repo SKILL.md is overwritten.
        BedrockGuardrailScanner.from_env(),
        dashboard_base_url=dashboard_base_url,
        named_entity_policy=load_named_entity_policy(),
        # T1 (spec 017): durable checkpointer so a Gate #3 thread resumes across the separate
        # Actions invocation that records the reviewer's approve/reject decision (PRD §5.6).
        checkpointer=checkpointer,
    )
    config = {"configurable": {"thread_id": thread_id}}

    if resume_decision is not None:
        # Continue the halted graph past Gate #3 with the recorded human decision + reviewer.
        # with_retries (spec 012 T2) makes the post-gate repo-write path resilient to a
        # transient Bedrock/GitHub blip; the single SKILL.md write is idempotent on re-entry.
        with_retries(
            lambda: graph.invoke(
                Command(resume={"decision": resume_decision, "reviewer": reviewer}),
                config,
            ),
            label=f"skill resume {release_run_id}",
        )
        logger.info(
            "skill run %s resumed at Gate #3 (%s)", release_run_id, resume_decision
        )
        return 0

    initial = SkillLearningState(
        release_run_id=release_run_id, thread_id=thread_id, repo=repo
    )
    result = with_retries(
        lambda: graph.invoke(initial, config), label=f"skill run {release_run_id}"
    )
    if "__interrupt__" in result:
        logger.info(
            "skill run %s halted at Gate #3 (thread %s); awaiting review",
            release_run_id,
            thread_id,
        )
    else:
        logger.info("skill run %s completed (thread %s)", release_run_id, thread_id)
    return 0


def _run_eval(conn: psycopg.Connection, release_run_id: str) -> int:
    """Run the product-evaluation step for one run AFTER artifact approval (spec 013, PRD §17).

    Compute the deterministic §17.1 metrics (evidence coverage, unsupported-claim rate, edit
    distance, approval latency, feature rejection rate, skill-candidate acceptance rate, media
    success rate) and run the §17.2 LLM-as-judge rubric over each Gate#2-approved artifact, then
    persist every result to ``eval_runs`` (migration 0012). This is a deterministic measurement
    step, not a LangGraph graph — like the ``privacy`` CLI — so it owns no graph state or gate.

    constitution §2 — every row scoped by ``release_run_id``; §5 — only scores + counts are
    written (the artifact body the rubric reads never reaches a row); §1 — runs on the Actions
    runner, never the Vercel app. The rubric uses the same Bedrock Converse seam (routed +
    budgeted via the ``evaluate_rubric`` NodeRoute) and cost telemetry as every other call.
    """
    produced = run_product_evaluation(
        release_run_id,
        AuroraMetricInputsReader(conn, release_run_id),
        AuroraApprovedArtifactReader(conn, release_run_id),
        BedrockModelClient.from_env(
            release_run_id=release_run_id,
            telemetry_sink=AuroraCostTelemetrySink(conn),
        ),
        AuroraEvalSink(conn),
    )
    logger.info("eval run %s recorded %d eval rows", release_run_id, len(produced))
    return 0


def main(argv: list[str] | None = None) -> int:
    raw = sys.argv[1:] if argv is None else argv
    # T1/T2/T3 (spec 010) — `python -m release_worker privacy <sub>` delegates to the GDPR
    # data-subject-rights CLI (retention-sweep / erase / export). Matched on the literal first
    # arg so the existing flat release-worker parser (--release-run-id ...) is untouched.
    if raw and raw[0] == "privacy":
        return privacy_main(raw[1:])

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    # T4 (spec 010) / P5 — scrub PII/secrets from every log record before a handler emits it,
    # so no personal data reaches logs/telemetry even if a future log call interpolates it.
    install_pii_scrubbing()
    args = _parse_args(raw)
    release_run_id = args.release_run_id

    # T1/T2 (spec 012) — thread-id resolution that makes resume idempotent re-entry:
    # a resume reuses the caller-supplied thread (PRD §5.6 "resume the same thread_id");
    # otherwise we derive a DETERMINISTIC per-(run, phase) id from loop_orchestration, so
    # re-dispatching a graph for a run lands on the SAME checkpointed thread rather than
    # forking a fresh one. Distinct per phase so the four graphs never collide on one run.
    # The ``eval`` step is not a LangGraph graph (no checkpoint/thread); every other graph
    # derives a deterministic per-(run, phase) thread id. Guard the derivation so ``eval``
    # never hits ``phase_from_graph`` (which only knows the four graph phases).
    thread_id = args.thread_id
    if thread_id is None and args.graph != "eval":
        thread_id = thread_id_for(release_run_id, phase_from_graph(args.graph))
    dashboard_base_url = os.environ.get("DASHBOARD_BASE_URL")
    if not dashboard_base_url:
        logger.warning(
            "DASHBOARD_BASE_URL is not set; gate review links will use the placeholder %s and "
            "will not reach the real dashboard",
            _PLACEHOLDER_DASHBOARD_URL,
        )
        dashboard_base_url = _PLACEHOLDER_DASHBOARD_URL

    # One shared connection for the whole short-lived job (aurora-postgresql-rules).
    conn = connect_from_env()
    repository = AuroraReleaseRunRepository(conn)
    try:
        if args.graph == "eval":
            # Spec 013 slice: after artifact approval, compute §17.1 metrics + run the §17.2
            # LLM-as-judge rubric over approved artifacts and persist to eval_runs. Not a graph
            # (no gate/thread), so it branches before any thread-id use.
            return _run_eval(conn, release_run_id)

        # T1 (spec 017): one durable checkpointer for whichever graph this invocation runs, so
        # a thread written by the initial invocation survives into the separate Actions
        # invocation that resumes it (PRD §5.6). Falls back to MemorySaver when no DSN is set
        # (dev/test). T2/T3 (spec 017): one embedding seam shared by evidence persistence
        # (release graph) and claim grounding (content graph). Built after the eval early-return
        # so the non-graph eval step pays for neither.
        checkpointer = build_checkpointer()
        # Cross-process resume needs the durable (Postgres) checkpointer: the thread written by
        # the initial invocation must survive into this separate resume invocation. Fail fast
        # rather than silently resuming against an empty in-process MemorySaver.
        if args.resume_decision is not None and not wants_durable_checkpointer():
            raise RuntimeError(
                "cross-process resume requires a durable checkpointer (set DATABASE_URL)"
            )
        embedder = BedrockEmbeddingClient.from_env(
            release_run_id=release_run_id,
            telemetry_sink=AuroraCostTelemetrySink(conn),
        )

        if args.graph == "content_generation":
            # Spec 005/006 slice: generate drafts → claims → checks → Gate #2 interrupt.
            # Initial run halts at Gate #2; --resume-decision continues the same thread.
            return _run_content_generation(
                conn,
                repository,
                release_run_id,
                thread_id,
                dashboard_base_url,
                args.resume_decision,
                embedder,
                checkpointer,
            )

        if args.graph == "media_generation":
            # Spec 008 slice: approved demo_script → validated click-path → Playwright capture
            # → ElevenLabs narration → ffmpeg → S3 → media_assets. No human gate (the script is
            # already Gate#2-approved); runs straight through on the Actions runner. spec 014 T1:
            # --feature-id scopes the demo_script to a triggered feature; spec 014 T3: a broken
            # step is surfaced as a 'broken' asset rather than failing the run opaquely.
            return _run_media_generation(
                conn,
                repository,
                release_run_id,
                thread_id,
                args.feature_id,
                checkpointer,
            )

        if args.graph == "skill_learning":
            # Spec 009 slice: mine learning signals → cluster → draft a staged skill candidate →
            # Gate #3 interrupt. Initial run halts at Gate #3; --resume-decision continues the same
            # thread (approve → repo SKILL.md replaced + promotion recorded; reject → suppression).
            return _run_skill_learning(
                conn,
                release_run_id,
                thread_id,
                dashboard_base_url,
                args.resume_decision,
                args.reviewer,
                checkpointer,
            )

        graph = build_release_intelligence_graph(
            repository,
            AuroraBoundaryReader(conn),
            GitHubDiffSource.from_env(),
            GitHubPullRequestSource.from_env(),
            S3AuroraEvidenceSink(
                conn, s3_client_from_env(), _require_env("EVIDENCE_BUCKET")
            ),
            AuroraRedactedEvidenceReader(conn),
            BedrockModelClient.from_env(
                release_run_id=release_run_id,
                telemetry_sink=AuroraCostTelemetrySink(conn),
            ),
            AuroraFeatureSink(conn),
            dashboard_base_url=dashboard_base_url,
            # T2 (spec 017): embed each redacted evidence row on persist so §11 semantic
            # retrieval has vectors to rank. T1: durable checkpointer so the Gate #1 thread
            # resumes across the separate Actions invocation that records the decision.
            embedder=embedder,
            checkpointer=checkpointer,
        )
        config = {"configurable": {"thread_id": thread_id}}

        if args.resume_decision is not None:
            # Continue the halted graph past Gate #1 with the recorded human decision.
            # with_retries (spec 012 T2): a transient Bedrock/GitHub/S3 error retries the
            # same checkpointed thread (idempotent re-entry), never a fork.
            with_retries(
                lambda: graph.invoke(Command(resume=args.resume_decision), config),
                label=f"release resume {release_run_id}",
            )
            logger.info(
                "release run %s resumed (%s)", release_run_id, args.resume_decision
            )
            return 0

        initial = ReleaseRunState(release_run_id=release_run_id, thread_id=thread_id)
        result = with_retries(
            lambda: graph.invoke(initial, config), label=f"release run {release_run_id}"
        )
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
        logger.exception(
            "release run %s failed (graph=%s, thread=%s)",
            release_run_id,
            args.graph,
            thread_id,
        )
        try:
            repository.mark_failed(release_run_id)
        except Exception:
            logger.exception("could not mark release run %s failed", release_run_id)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
