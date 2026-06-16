"""T2/T3/T4/T5 (spec 008) — the node chain of media_generation_graph.

Exercises the exact public surface the graph nodes wrap — demo-script load, click-path
generation + STRICT validation, Playwright capture, narration, ffmpeg assembly, S3 store, and
media-asset persistence — against the in-memory fakes (anti-pattern #4: no private helper, no
browser/ElevenLabs/S3/DB). The fakes record what was driven / stored, so the constitution's
invariants are *proven* by inspection:

* §5 — a malicious/invalid click-path (unknown action, unsafe selector, unsafe nav target) is
  REJECTED by validate_click_path and the capturer is never called (it never reaches Playwright).
* §5 — run_playwright_capture only accepts a ValidatedClickPath, which only validate_click_path
  mints, so the validated path is the one captured.
* elevenlabs-rules — narration is content-hash idempotent (same input → one synthesis); the key
  folds in voice/model/format; the audio is materialized before ffmpeg, which REFUSES a
  non-materialized input.
* §4/s3-rules — the stored key is run-scoped + sanitized; only the s3_uri + provenance persist.
"""

from __future__ import annotations

import pytest

from release_worker.media_models import (
    AssembledMedia,
    CaptureResult,
    ClickAction,
    ClickPathValidationError,
    GeneratedClickPath,
    GeneratedClickStep,
    MalformedClickPathError,
    NarrationConfig,
    NarrationResult,
    ValidatedClickPath,
)
from release_worker.media_nodes import (
    MEDIA_STATUS_BROKEN,
    MEDIA_TYPE_DEMO_VIDEO,
    assemble_video_ffmpeg,
    generate_click_path_json,
    generate_narration,
    load_approved_demo_script,
    narration_content_hash,
    persist_media_asset,
    record_broken_step,
    run_playwright_capture,
    store_media_s3,
    store_raw_recording,
    validate_click_path,
)
from release_worker.media_ports import (
    InMemoryDemoScriptReader,
    InMemoryMediaAssetSink,
    InMemoryMediaStore,
    InMemoryNarrationSynthesizer,
    InMemoryPlaywrightCapturer,
    InMemoryVideoAssembler,
    NoApprovedDemoScriptError,
)
from release_worker.model_client import RecordingModelClient

_RUN_ID = "11111111-1111-4111-8111-111111111111"
_ART_ID = "aaaaaaaa-1111-2222-3333-444444444444"
_MEDIA_ID = "bbbbbbbb-1111-2222-3333-444444444444"
_FEATURE_ID = "cccccccc-1111-2222-3333-444444444444"

# A well-formed click-path the model might emit: navigate + click + fill + expect_text.
_GOOD_CLICKPATH: dict[str, object] = {
    "steps": [
        {"action": "navigate", "target": "/releases", "narration": "Open releases."},
        {
            "action": "click",
            "selector": '[data-testid="new-checklist"]',
            "narration": "Start a checklist.",
        },
        {
            "action": "fill",
            "selector": "#title",
            "target": "Onboarding",
            "narration": "Name it.",
        },
        {
            "action": "expect_text",
            "selector": ".toast",
            "narration": "Confirm it saved.",
        },
    ]
}

_CONFIG = NarrationConfig(
    voice_id="voice-abc",
    model_id="eleven_multilingual_v2",
    output_format="mp3_44100_128",
)


def _capture() -> CaptureResult:
    return CaptureResult(
        video_local_path="/tmp/capture/capture.webm",
        frames=(),
        duration_seconds=8.0,
        step_count=4,
    )


def _reader() -> InMemoryDemoScriptReader:
    return InMemoryDemoScriptReader(
        (_ART_ID, "Demo", "1. Open releases. 2. Create a checklist.", _FEATURE_ID)
    )


# --- load_approved_demo_script ----------------------------------------------------


def test_load_approved_demo_script_returns_the_approved_script() -> None:
    artifact_id, title, body, feature_id = load_approved_demo_script(_RUN_ID, _reader())
    assert artifact_id == _ART_ID
    assert feature_id == _FEATURE_ID
    assert "checklist" in body


def test_load_fails_closed_with_no_approved_demo_script() -> None:
    """AC/§5: the media graph renders nothing without an approved demo_script."""
    with pytest.raises(NoApprovedDemoScriptError):
        load_approved_demo_script(_RUN_ID, InMemoryDemoScriptReader(None))


# --- T2 — generate + validate click-path ------------------------------------------


def test_generate_click_path_validates_model_shape() -> None:
    client = RecordingModelClient(_GOOD_CLICKPATH)
    generated = generate_click_path_json(
        _ART_ID, "open releases; create checklist", client
    )
    assert isinstance(generated, GeneratedClickPath)
    assert len(generated.steps) == 4
    # The prompt carried only the (approved) demo-script body.
    assert client.calls[-1].messages[0]["content"] == "open releases; create checklist"


def test_generate_click_path_idempotency_key_stable() -> None:
    client_a = RecordingModelClient(_GOOD_CLICKPATH)
    client_b = RecordingModelClient(_GOOD_CLICKPATH)
    generate_click_path_json(_ART_ID, "same script body", client_a)
    generate_click_path_json(_ART_ID, "same script body", client_b)
    assert client_a.calls[-1].idempotency_key == client_b.calls[-1].idempotency_key


def test_generate_click_path_rejects_malformed_output() -> None:
    # steps is not a list of objects — structural boundary failure.
    client = RecordingModelClient({"steps": [{"selector": 123}]})
    with pytest.raises(MalformedClickPathError) as exc:
        generate_click_path_json(_ART_ID, "body", client)
    assert "malformed" in str(exc.value)


def test_validate_click_path_accepts_a_safe_path() -> None:
    generated = GeneratedClickPath.model_validate(_GOOD_CLICKPATH)
    validated = validate_click_path(generated)
    assert isinstance(validated, ValidatedClickPath)
    assert tuple(s.action for s in validated.steps) == (
        ClickAction.NAVIGATE,
        ClickAction.CLICK,
        ClickAction.FILL,
        ClickAction.EXPECT_TEXT,
    )


def test_validate_click_path_rejects_unknown_action() -> None:
    """AC: an unknown action (e.g. a smuggled 'evaluate') is rejected before any execution."""
    generated = GeneratedClickPath(
        steps=(GeneratedClickStep(action="evaluate", selector="#x"),)
    )
    with pytest.raises(ClickPathValidationError) as exc:
        validate_click_path(generated)
    assert exc.value.reason == "unknown action"


def test_validate_click_path_rejects_unsafe_selector() -> None:
    """AC: a malicious selector (javascript: payload) is rejected; never echoed in the error."""
    payload = "a:has(javascript:alert(1))"
    generated = GeneratedClickPath(
        steps=(GeneratedClickStep(action="click", selector=payload),)
    )
    with pytest.raises(ClickPathValidationError) as exc:
        validate_click_path(generated)
    assert exc.value.reason == "unsafe selector"
    assert payload not in str(exc.value)  # the offending value is never echoed (§5)


def test_validate_click_path_rejects_absolute_navigation_target() -> None:
    """AC: navigation must stay in-app; an absolute/remote URL is rejected."""
    generated = GeneratedClickPath(
        steps=(GeneratedClickStep(action="navigate", target="https://evil.example/x"),)
    )
    with pytest.raises(ClickPathValidationError) as exc:
        validate_click_path(generated)
    assert exc.value.reason == "unsafe navigation target"


def test_validate_click_path_rejects_selector_action_without_selector() -> None:
    generated = GeneratedClickPath(steps=(GeneratedClickStep(action="click"),))
    with pytest.raises(ClickPathValidationError) as exc:
        validate_click_path(generated)
    assert exc.value.reason == "missing selector"


def test_validate_click_path_rejects_empty_path() -> None:
    with pytest.raises(ClickPathValidationError):
        validate_click_path(GeneratedClickPath(steps=()))


# --- T3 — run_playwright_capture (only a validated path reaches Playwright) --------


def test_malicious_click_path_never_reaches_playwright() -> None:
    """AC (the headline): an invalid/malicious click-path is rejected by validation and the
    Playwright capturer is never invoked."""
    capturer = InMemoryPlaywrightCapturer(_capture())
    generated = GeneratedClickPath(
        steps=(GeneratedClickStep(action="evaluate", selector="#x"),)
    )
    with pytest.raises(ClickPathValidationError):
        validated = validate_click_path(generated)
        run_playwright_capture(validated, capturer)  # unreachable
    assert capturer.captured == []  # the browser was never driven


def test_validated_path_is_the_one_captured() -> None:
    capturer = InMemoryPlaywrightCapturer(_capture())
    validated = validate_click_path(GeneratedClickPath.model_validate(_GOOD_CLICKPATH))
    result = run_playwright_capture(validated, capturer)
    assert result.step_count == 4
    assert capturer.captured == [validated]  # exactly the validated path was executed


# --- T4 — generate_narration (content-hash idempotent, materialized) --------------


def test_narration_content_hash_folds_in_voice_model_format() -> None:
    base = narration_content_hash("hello", _CONFIG)
    other_voice = narration_content_hash(
        "hello", _CONFIG.model_copy(update={"voice_id": "voice-zzz"})
    )
    other_text = narration_content_hash("hello world", _CONFIG)
    assert base != other_voice  # a voice change is a different asset
    assert base != other_text  # a text change is a different asset


def test_generate_narration_is_idempotent_on_content_hash() -> None:
    """elevenlabs-rules: the same (text+voice+model+format) synthesizes once (no double bill)."""
    synth = InMemoryNarrationSynthesizer()
    first = generate_narration("Welcome to the demo.", synth, _CONFIG)
    second = generate_narration("Welcome to the demo.", synth, _CONFIG)
    assert first.content_hash == second.content_hash
    assert first.materialized is True
    assert synth.synthesized == [first.content_hash]  # exactly one real synthesis


# --- T5 — assemble (ffmpeg) → store (S3) → persist (Aurora) ------------------------


def test_assemble_refuses_non_materialized_audio() -> None:
    """AC/elevenlabs-rules: ffmpeg only assembles after audio is fully materialized."""
    assembler = InMemoryVideoAssembler()
    partial = NarrationResult(
        content_hash="h",
        audio_local_path="/tmp/partial.mp3",
        voice_id="v",
        model_id="m",
        output_format="mp3_44100_128",
        char_count=3,
        materialized=False,
    )
    with pytest.raises(ValueError, match="materialized"):
        assemble_video_ffmpeg(_capture(), partial, assembler, "media-1")
    assert assembler.assembled == []  # nothing was muxed from a partial stream


def test_assemble_runs_on_materialized_audio() -> None:
    synth = InMemoryNarrationSynthesizer()
    narration = generate_narration("Welcome.", synth, _CONFIG)
    assembler = InMemoryVideoAssembler()
    media = assemble_video_ffmpeg(_capture(), narration, assembler, "media-1")
    assert isinstance(media, AssembledMedia)
    assert len(assembler.assembled) == 1


def test_store_media_s3_uses_run_scoped_sanitized_key() -> None:
    store = InMemoryMediaStore()
    media = AssembledMedia(
        local_path="/tmp/demo.mp4", content_type="video/mp4", duration_seconds=8.0
    )
    uri = store_media_s3(_RUN_ID, _MEDIA_ID, media, store)
    assert uri.startswith("s3://")
    assert store.stored == [f"media/{_RUN_ID}/{_MEDIA_ID}.mp4"]  # run-scoped key


def test_persist_media_asset_records_provenance_and_uri() -> None:
    """AC: only the S3 URI + provenance persist (the binary stays in S3); provenance ties the
    media back to its approved source + the validated click-path + narration inputs."""
    synth = InMemoryNarrationSynthesizer()
    narration = generate_narration("Welcome.", synth, _CONFIG)
    validated = validate_click_path(GeneratedClickPath.model_validate(_GOOD_CLICKPATH))
    media = AssembledMedia(
        local_path="/tmp/demo.mp4", content_type="video/mp4", duration_seconds=8.0
    )
    sink = InMemoryMediaAssetSink()

    asset = persist_media_asset(
        _MEDIA_ID,
        _RUN_ID,
        _ART_ID,
        _FEATURE_ID,
        MEDIA_TYPE_DEMO_VIDEO,
        f"s3://media-bucket/media/{_RUN_ID}/{_MEDIA_ID}.mp4",
        media,
        narration,
        validated,
        sink,
    )

    assert sink.assets == [asset]
    assert asset.s3_uri is not None  # a successful asset always has stored media
    assert asset.s3_uri.startswith("s3://")
    assert asset.media_type == MEDIA_TYPE_DEMO_VIDEO
    # Provenance carries the audit trail (source artifact, click-path hash, narration key, voice).
    assert asset.provenance["source_artifact_id"] == _ART_ID
    assert asset.provenance["narration_content_hash"] == narration.content_hash
    assert asset.provenance["voice_id"] == _CONFIG.voice_id
    assert asset.provenance["clickpath_hash"]  # a non-empty deterministic hash


def test_persist_media_asset_clickpath_hash_is_deterministic() -> None:
    """The provenance click-path hash is reproducible from the same validated path."""
    validated = validate_click_path(GeneratedClickPath.model_validate(_GOOD_CLICKPATH))
    synth = InMemoryNarrationSynthesizer()
    narration = generate_narration("Welcome.", synth, _CONFIG)
    media = AssembledMedia(
        local_path="/tmp/demo.mp4", content_type="video/mp4", duration_seconds=8.0
    )

    def _persist() -> str:
        sink = InMemoryMediaAssetSink()
        asset = persist_media_asset(
            _MEDIA_ID,
            _RUN_ID,
            _ART_ID,
            _FEATURE_ID,
            MEDIA_TYPE_DEMO_VIDEO,
            "s3://media-bucket/x.mp4",
            media,
            narration,
            validated,
            sink,
        )
        return asset.provenance["clickpath_hash"]

    assert _persist() == _persist()


# --- T1 (spec 014) — the load node scopes to the reviewer's chosen feature ---------


def test_load_forwards_requested_feature_id() -> None:
    """AC (T1): generate-demo for a specific feature scopes the demo_script lookup to it."""
    reader = _reader()
    load_approved_demo_script(_RUN_ID, reader, _FEATURE_ID)
    assert reader.requested_feature_ids == [_FEATURE_ID]


def test_load_without_feature_id_is_run_wide() -> None:
    reader = _reader()
    load_approved_demo_script(_RUN_ID, reader)
    assert reader.requested_feature_ids == [None]


# --- T3 (spec 014) — raw recording stored separately; broken-step asset persisted --


def test_store_raw_recording_uses_a_separate_key_from_the_final_media() -> None:
    """AC/§16.3: the raw recording and the final video are stored separately."""
    store = InMemoryMediaStore()
    final = AssembledMedia(
        local_path="/tmp/demo.mp4", content_type="video/mp4", duration_seconds=8.0
    )
    final_uri = store_media_s3(_RUN_ID, _MEDIA_ID, final, store)
    raw_uri = store_raw_recording(_RUN_ID, _MEDIA_ID, _capture(), store)
    assert raw_uri != final_uri  # distinct objects
    assert store.stored == [f"media/{_RUN_ID}/{_MEDIA_ID}.mp4"]
    assert store.stored_raw == [f"media/{_RUN_ID}/{_MEDIA_ID}-raw.mp4"]


def test_record_broken_step_persists_status_and_step() -> None:
    """AC/§16.3: a failed media step is persisted as a 'broken' asset naming the step, instead
    of failing the whole run opaquely. The raw recording (if any) is its s3_uri; the narration
    script is preserved as the transcript."""
    sink = InMemoryMediaAssetSink()
    raw_uri = f"s3://media-bucket/media/{_RUN_ID}/{_MEDIA_ID}-raw.webm"
    asset = record_broken_step(
        _MEDIA_ID,
        _RUN_ID,
        _ART_ID,
        _FEATURE_ID,
        "assemble_video_ffmpeg",
        "ValueError: narration audio is not fully materialized",
        sink,
        raw_s3_uri=raw_uri,
        transcript="Welcome to the demo.",
    )
    assert sink.assets == [asset]
    assert asset.status == MEDIA_STATUS_BROKEN
    assert asset.provenance["broken_step"] == "assemble_video_ffmpeg"
    assert "materialized" in asset.provenance["failure"]
    # The separately-stored raw recording is the broken asset's playable artifact + provenance.
    assert asset.s3_uri == raw_uri
    assert asset.provenance["raw_s3_uri"] == raw_uri
    assert asset.transcript == "Welcome to the demo."


def test_record_broken_step_before_capture_has_no_media() -> None:
    """A step that breaks before any capture (e.g. an unsafe click-path) records a broken asset
    with no stored media (null s3_uri) — the 0013 CHECK permits that only for a broken row."""
    sink = InMemoryMediaAssetSink()
    asset = record_broken_step(
        _MEDIA_ID,
        _RUN_ID,
        _ART_ID,
        _FEATURE_ID,
        "validate_click_path",
        "ClickPathValidationError: click-path step 0 rejected: unsafe selector",
        sink,
    )
    assert asset.status == MEDIA_STATUS_BROKEN
    assert asset.s3_uri is None  # nothing was stored
    assert asset.provenance["broken_step"] == "validate_click_path"
    assert "raw_s3_uri" not in asset.provenance


def test_persist_media_asset_records_transcript_and_raw_uri() -> None:
    """T3: a successful asset preserves the transcript and records the separately-stored raw
    recording's URI in provenance (§16.3)."""
    synth = InMemoryNarrationSynthesizer()
    narration = generate_narration("Welcome.", synth, _CONFIG)
    validated = validate_click_path(GeneratedClickPath.model_validate(_GOOD_CLICKPATH))
    media = AssembledMedia(
        local_path="/tmp/demo.mp4", content_type="video/mp4", duration_seconds=8.0
    )
    sink = InMemoryMediaAssetSink()
    raw_uri = "s3://media-bucket/media/run/x-raw.webm"
    asset = persist_media_asset(
        _MEDIA_ID,
        _RUN_ID,
        _ART_ID,
        _FEATURE_ID,
        MEDIA_TYPE_DEMO_VIDEO,
        "s3://media-bucket/x.mp4",
        media,
        narration,
        validated,
        sink,
        transcript="The full narration script.",
        raw_s3_uri=raw_uri,
    )
    assert asset.transcript == "The full narration script."
    assert asset.provenance["raw_s3_uri"] == raw_uri
    assert asset.status == "ready"
