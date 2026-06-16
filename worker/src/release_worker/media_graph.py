"""T2-T5 (spec 008) + T3 (spec 014) — LangGraph wiring for ``media_generation_graph`` (PRD §5.4).

P1 (Substrate): orchestration is LangGraph only. This module owns the *graph* (its nodes and
edges); LangGraph owns state threading, retries, and checkpointing. It imports ``langgraph`` so
it is loaded only by the runtime entry point (``__main__``), never by the unit-test gate — the
node logic itself is pure and unit-tested directly against in-memory fakes
(``worker/tests/test_media_nodes.py``).

    load_approved_demo_script → generate_click_path_json → validate_click_path
        → run_playwright_capture → store_raw_recording → generate_narration
        → assemble_video_ffmpeg → store_media_s3 → persist_media_asset

constitution §5 is enforced *structurally*, not by an interrupt: there is no human gate in
this graph (the human gates are upstream — the demo_script is already Gate#2-approved). The
safety rails are the two click-path validators (a malicious path is rejected at
``validate_click_path`` and ``run_playwright_capture`` only accepts a ``ValidatedClickPath``)
and the materialized-audio guard before ffmpeg.

spec 014 T3 / §16.3 — "fail gracefully and show broken step." Every node is wrapped in a guard:
a NON-transient failure (a rejected click-path, a missing approved script, an ffmpeg/synthesis
error) is captured into ``state.failed_step`` and the graph routes to ``handle_broken_step``,
which persists a ``status='broken'`` ``media_assets`` row naming the step — instead of crashing
the whole run opaquely. A TRANSIENT failure (throttle / 5xx / timeout) is RE-RAISED so the
``with_retries`` wrapper in ``__main__`` retries the idempotent re-entry (spec 012 T2) rather
than mislabelling a blip as a broken step. The raw recording is stored SEPARATELY from the final
video (a distinct S3 key) so a reviewer can inspect the capture even when a later step broke.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from release_worker.media_models import (
    ClickPathValidationError,
    MalformedClickPathError,
    NarrationConfig,
)
from release_worker.media_nodes import (
    MEDIA_TYPE_DEMO_VIDEO,
    assemble_video_ffmpeg,
    generate_click_path_json,
    generate_narration,
    load_approved_demo_script,
    persist_media_asset,
    record_broken_step,
    run_playwright_capture,
    store_media_s3,
    store_raw_recording,
    validate_click_path,
)
from release_worker.media_ports import (
    DemoScriptReader,
    MediaAssetSink,
    MediaStore,
    NarrationSynthesizer,
    NoApprovedDemoScriptError,
    PlaywrightCapturer,
    VideoAssembler,
)
from release_worker.media_state import MediaRunState
from release_worker.model_client import ModelClient
from release_worker.transient_retry import is_transient_error

# The ordered media steps, by node name (also the broken-step label surfaced to the dashboard).
_STEP_SEQUENCE = (
    "load_approved_demo_script",
    "generate_click_path_json",
    "validate_click_path",
    "run_playwright_capture",
    "store_raw_recording",
    "generate_narration",
    "assemble_video_ffmpeg",
    "store_media_s3",
    "persist_media_asset",
)

# Our own domain errors carry deliberately user-safe messages (they never echo the offending
# model output / selector / target — constitution §5), so it is safe to surface their text.
_USER_SAFE_ERRORS = (
    ClickPathValidationError,
    MalformedClickPathError,
    NoApprovedDemoScriptError,
)

logger = logging.getLogger("release_worker.media")

# Genuine programming errors must NOT be downgraded to a "broken media step": they surface as a
# run failure so they get caught and fixed, instead of masquerading as a content-generation
# failure with only a class name in the DB (spec 014 T3 is for real content/tooling failures).
_FATAL_PROGRAMMING_ERRORS = (
    AssertionError,
    AttributeError,
    KeyError,
    TypeError,
    NameError,
    ImportError,
)


def _user_safe_failure_detail(exc: Exception) -> str:
    """A bounded, user-safe summary of a node failure for the dashboard + audit (constitution §5).

    For our own domain errors the message is known-safe, so include it; for any other exception we
    surface only the class name (a third-party error could carry a bucket/key/credential in its
    text). Never the raw model output."""
    if isinstance(exc, _USER_SAFE_ERRORS):
        return f"{type(exc).__name__}: {exc}"[:300]
    return type(exc).__name__


def build_media_generation_graph(
    demo_script_reader: DemoScriptReader,
    model_client: ModelClient,
    capturer: PlaywrightCapturer,
    synthesizer: NarrationSynthesizer,
    assembler: VideoAssembler,
    media_store: MediaStore,
    media_sink: MediaAssetSink,
    *,
    checkpointer: object | None = None,
):
    """Compile the media-generation graph (PRD §5.4).

    The ports are captured in node closures so each node stays a pure function of its
    ``(inputs, port)`` while LangGraph only sees ``state -> state`` callables. The graph has no
    human interrupt — its demo_script input is already Gate#2-approved — so the bundled default
    ``MemorySaver`` is sufficient; a durable checkpointer can still be injected for resume.

    spec 014 T3: each step is wrapped in ``_guard`` and followed by a conditional edge that routes
    to ``handle_broken_step`` the moment a step records a non-transient failure (§16.3)."""

    def _load_approved_demo_script(state: MediaRunState) -> MediaRunState:
        # Fails closed (NoApprovedDemoScriptError) if no approved demo_script (constitution §5).
        # spec 014 T1: scope to the reviewer's chosen feature when one was supplied.
        artifact_id, title, body, feature_id = load_approved_demo_script(
            state.release_run_id, demo_script_reader, state.requested_feature_id
        )
        return state.model_copy(
            update={
                "source_artifact_id": artifact_id,
                "demo_title": title,
                "demo_body": body,
                "feature_id": feature_id,
            }
        )

    def _generate_click_path_json(state: MediaRunState) -> MediaRunState:
        assert state.source_artifact_id is not None  # set by the load node
        generated = generate_click_path_json(
            state.source_artifact_id, state.demo_body, model_client
        )
        return state.model_copy(update={"generated_click_path": generated})

    def _validate_click_path(state: MediaRunState) -> MediaRunState:
        # The safety gate: raises ClickPathValidationError on an unknown action / unsafe
        # selector / unsafe target, so a malicious path never reaches the capture node.
        assert state.generated_click_path is not None
        validated = validate_click_path(state.generated_click_path)
        return state.model_copy(update={"validated_click_path": validated})

    def _run_playwright_capture(state: MediaRunState) -> MediaRunState:
        # Accepts only the ValidatedClickPath the previous node minted (constitution §5).
        assert state.validated_click_path is not None
        capture = run_playwright_capture(state.validated_click_path, capturer)
        return state.model_copy(update={"capture": capture})

    def _store_raw_recording(state: MediaRunState) -> MediaRunState:
        # §16.3 — store the raw recording on a DISTINCT key from the final video, before
        # narration/assembly, so it survives a later break.
        assert state.capture is not None
        raw_uri = store_raw_recording(
            state.release_run_id, state.media_id, state.capture, media_store
        )
        return state.model_copy(update={"raw_s3_uri": raw_uri})

    def _generate_narration(state: MediaRunState) -> MediaRunState:
        config = NarrationConfig(
            voice_id=state.voice_id,
            model_id=state.model_id,
            output_format=state.output_format,
        )
        # Narrate the approved demo script body; content-hash idempotent (elevenlabs-rules).
        narration = generate_narration(state.demo_body, synthesizer, config)
        return state.model_copy(update={"narration": narration})

    def _assemble_video_ffmpeg(state: MediaRunState) -> MediaRunState:
        # Refuses to run until the narration audio is fully materialized (the AC).
        assert state.capture is not None and state.narration is not None
        media = assemble_video_ffmpeg(
            state.capture, state.narration, assembler, state.media_id
        )
        return state.model_copy(update={"assembled_media": media})

    def _store_media_s3(state: MediaRunState) -> MediaRunState:
        # Private, sanitized, run-scoped S3 key; only the URI is carried forward (s3-rules).
        assert state.assembled_media is not None
        s3_uri = store_media_s3(
            state.release_run_id, state.media_id, state.assembled_media, media_store
        )
        return state.model_copy(update={"s3_uri": s3_uri})

    def _persist_media_asset(state: MediaRunState) -> MediaRunState:
        assert (
            state.assembled_media is not None
            and state.narration is not None
            and state.validated_click_path is not None
            and state.s3_uri is not None
        )
        asset = persist_media_asset(
            state.media_id,
            state.release_run_id,
            state.source_artifact_id,
            state.feature_id,
            MEDIA_TYPE_DEMO_VIDEO,
            state.s3_uri,
            state.assembled_media,
            state.narration,
            state.validated_click_path,
            media_sink,
            transcript=state.demo_body or None,
            raw_s3_uri=state.raw_s3_uri,
        )
        return state.model_copy(update={"media_asset": asset})

    def _handle_broken_step(state: MediaRunState) -> MediaRunState:
        # §16.3 — persist a 'broken' asset naming the step that failed instead of failing the
        # whole run opaquely. The raw recording (if captured) is its s3_uri; the narration script
        # is preserved as the transcript when narration had completed.
        asset = record_broken_step(
            state.media_id,
            state.release_run_id,
            state.source_artifact_id,
            state.feature_id,
            state.failed_step or "unknown",
            state.failure_detail or "media generation failed",
            media_sink,
            raw_s3_uri=state.raw_s3_uri,
            transcript=state.demo_body or None if state.narration is not None else None,
        )
        return state.model_copy(update={"media_asset": asset})

    def _guard(
        step_name: str, fn: Callable[[MediaRunState], MediaRunState]
    ) -> Callable[[MediaRunState], MediaRunState]:
        # spec 014 T3 — run the node; on a NON-transient error capture the step + a user-safe
        # detail into state (the graph then routes to handle_broken_step). RE-RAISE a transient
        # error so __main__'s with_retries retries the idempotent re-entry (spec 012 T2), never
        # mislabelling a throttle/5xx/timeout as a broken step.
        def wrapped(state: MediaRunState) -> MediaRunState:
            try:
                return fn(state)
            except Exception as err:  # noqa: BLE001 — re-raised below unless captured as broken
                if is_transient_error(err):
                    raise  # a throttle/5xx/timeout: with_retries retries; not a broken step
                # Always log the full traceback with step context — the user-safe detail that
                # reaches the DB/UI is only a class name, so the trace must live in the (already
                # PII-scrubbed) log or the failure is undebuggable (observability).
                logger.exception(
                    "media step %s failed for run %s", step_name, state.release_run_id
                )
                if isinstance(err, _FATAL_PROGRAMMING_ERRORS):
                    # A real bug, not a content failure — surface it as a run failure rather
                    # than masking it behind a 'broken' media asset.
                    raise
                return state.model_copy(
                    update={
                        "failed_step": step_name,
                        "failure_detail": _user_safe_failure_detail(err),
                    }
                )

        return wrapped

    def _route(state: MediaRunState) -> str:
        return "broken" if state.failed_step is not None else "continue"

    _node_fns: dict[str, Callable[[MediaRunState], MediaRunState]] = {
        "load_approved_demo_script": _load_approved_demo_script,
        "generate_click_path_json": _generate_click_path_json,
        "validate_click_path": _validate_click_path,
        "run_playwright_capture": _run_playwright_capture,
        "store_raw_recording": _store_raw_recording,
        "generate_narration": _generate_narration,
        "assemble_video_ffmpeg": _assemble_video_ffmpeg,
        "store_media_s3": _store_media_s3,
        "persist_media_asset": _persist_media_asset,
    }

    graph: StateGraph = StateGraph(MediaRunState)
    for name in _STEP_SEQUENCE:
        graph.add_node(name, _guard(name, _node_fns[name]))
    graph.add_node("handle_broken_step", _handle_broken_step)

    graph.add_edge(START, _STEP_SEQUENCE[0])
    for index, name in enumerate(_STEP_SEQUENCE):
        nxt = _STEP_SEQUENCE[index + 1] if index + 1 < len(_STEP_SEQUENCE) else END
        # After every step: a captured failure short-circuits to the broken-step handler;
        # otherwise continue to the next step (§16.3 fail-gracefully routing).
        graph.add_conditional_edges(
            name, _route, {"broken": "handle_broken_step", "continue": nxt}
        )
    graph.add_edge("handle_broken_step", END)

    return graph.compile(checkpointer=checkpointer or MemorySaver())
