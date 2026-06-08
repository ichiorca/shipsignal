"""T2-T5 (spec 008) — LangGraph wiring for ``media_generation_graph`` (PRD §5.4).

P1 (Substrate): orchestration is LangGraph only. This module owns the *graph* (its nodes and
edges); LangGraph owns state threading, retries, and checkpointing. It imports ``langgraph`` so
it is loaded only by the runtime entry point (``__main__``), never by the unit-test gate — the
node logic itself is pure and unit-tested directly against in-memory fakes
(``worker/tests/test_media_nodes.py``).

    load_approved_demo_script → generate_click_path_json → validate_click_path
        → run_playwright_capture → generate_narration → assemble_video_ffmpeg
        → store_media_s3 → persist_media_asset

constitution §5 is enforced *structurally*, not by an interrupt: there is no human gate in
this graph (the human gates are upstream — the demo_script is already Gate#2-approved). The
safety rails are the two click-path validators (a malicious path is rejected at
``validate_click_path`` and ``run_playwright_capture`` only accepts a ``ValidatedClickPath``)
and the materialized-audio guard before ffmpeg. A failure in any node propagates so ``__main__``
marks the run failed — capture/narration/assembly never silently half-render.
"""

from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from release_worker.media_models import NarrationConfig
from release_worker.media_nodes import (
    MEDIA_TYPE_DEMO_VIDEO,
    assemble_video_ffmpeg,
    generate_click_path_json,
    generate_narration,
    load_approved_demo_script,
    persist_media_asset,
    run_playwright_capture,
    store_media_s3,
    validate_click_path,
)
from release_worker.media_ports import (
    DemoScriptReader,
    MediaAssetSink,
    MediaStore,
    NarrationSynthesizer,
    PlaywrightCapturer,
    VideoAssembler,
)
from release_worker.media_state import MediaRunState
from release_worker.model_client import ModelClient


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
    ``MemorySaver`` is sufficient; a durable checkpointer can still be injected for resume."""

    def _load_approved_demo_script(state: MediaRunState) -> MediaRunState:
        # Fails closed (NoApprovedDemoScriptError) if no approved demo_script (constitution §5).
        artifact_id, title, body, feature_id = load_approved_demo_script(
            state.release_run_id, demo_script_reader
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
        media = assemble_video_ffmpeg(state.capture, state.narration, assembler)
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
        )
        return state.model_copy(update={"media_asset": asset})

    graph: StateGraph = StateGraph(MediaRunState)
    graph.add_node("load_approved_demo_script", _load_approved_demo_script)
    graph.add_node("generate_click_path_json", _generate_click_path_json)
    graph.add_node("validate_click_path", _validate_click_path)
    graph.add_node("run_playwright_capture", _run_playwright_capture)
    graph.add_node("generate_narration", _generate_narration)
    graph.add_node("assemble_video_ffmpeg", _assemble_video_ffmpeg)
    graph.add_node("store_media_s3", _store_media_s3)
    graph.add_node("persist_media_asset", _persist_media_asset)

    graph.add_edge(START, "load_approved_demo_script")
    graph.add_edge("load_approved_demo_script", "generate_click_path_json")
    graph.add_edge("generate_click_path_json", "validate_click_path")
    graph.add_edge("validate_click_path", "run_playwright_capture")
    graph.add_edge("run_playwright_capture", "generate_narration")
    graph.add_edge("generate_narration", "assemble_video_ffmpeg")
    graph.add_edge("assemble_video_ffmpeg", "store_media_s3")
    graph.add_edge("store_media_s3", "persist_media_asset")
    graph.add_edge("persist_media_asset", END)

    return graph.compile(checkpointer=checkpointer or MemorySaver())
