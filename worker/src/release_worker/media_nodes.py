"""T2/T3/T4/T5 (spec 008) — the node logic of ``media_generation_graph`` (PRD §5.4):
load_approved_demo_script → generate_click_path_json → validate_click_path →
run_playwright_capture → generate_narration → assemble_video_ffmpeg → store_media_s3 →
persist_media_asset.

Each node is a pure function of ``(inputs, port)`` — no langgraph/playwright/boto3/elevenlabs
import — so it is unit-tested through the exact surface the graph invokes (anti-pattern #4).
The constitution's load-bearing rules are enforced *structurally*:

* §5 — model output is untrusted: ``generate_click_path_json`` validates the Bedrock response
  through ``GeneratedClickPath`` (a malformed payload fails closed) and ``validate_click_path``
  applies a strict action/selector allowlist, minting a ``ValidatedClickPath`` only when every
  step is safe. ``run_playwright_capture`` accepts ONLY a ``ValidatedClickPath`` — so an
  invalid/malicious click-path is rejected and never reaches Playwright (the AC).
* §1/§5 — capture runs only on the Actions runner against synthetic fixture data; the node
  never executes model-emitted code (there is no ``evaluate`` action).
* elevenlabs-rules — ``generate_narration`` computes the content-hash idempotency key and the
  synthesizer dedupes on it; ``assemble_video_ffmpeg`` REFUSES to run until the narration audio
  is fully materialized (the AC: ffmpeg only assembles after audio is materialized).
* §4/s3-rules — ``store_media_s3`` writes a private, sanitized, run-scoped key; only the S3 URI
  + provenance are persisted by ``persist_media_asset`` (the binary stays in S3).
"""

from __future__ import annotations

import hashlib

from pydantic import ValidationError

from release_worker.media_models import (
    MAX_STEPS,
    SELECTOR_ACTIONS,
    AssembledMedia,
    CaptureResult,
    ClickAction,
    ClickPathValidationError,
    ClickStep,
    GeneratedClickPath,
    MalformedClickPathError,
    MediaAsset,
    NarrationConfig,
    NarrationResult,
    ValidatedClickPath,
    is_safe_selector,
    is_safe_target_path,
)
from release_worker.media_ports import (
    DemoScriptReader,
    MediaAssetSink,
    MediaStore,
    NarrationSynthesizer,
    PlaywrightCapturer,
    VideoAssembler,
)
from release_worker.model_client import ModelClient

# Bumped whenever the click-path prompt/template changes so the audit trail records which
# template produced a path (§18.3).
CLICKPATH_PROMPT_VERSION = "clickpath-v1"
# The media kinds this graph renders (PRD §8.1 demo_script → demo_video, audio digest).
MEDIA_TYPE_DEMO_VIDEO = "demo_video"
# spec 014 T3 / §16.3 — a media asset whose generation broke at a step. Persisted (not raised)
# so the dashboard surfaces WHICH step broke instead of the run failing opaquely.
MEDIA_STATUS_BROKEN = "broken"


# --- load_approved_demo_script ----------------------------------------------------


def load_approved_demo_script(
    release_run_id: str, reader: DemoScriptReader, feature_id: str | None = None
) -> tuple[str, str, str, str | None]:
    """Load the run's Gate#2-approved ``demo_script`` (PRD §5.4).

    Fails closed via the reader (``NoApprovedDemoScriptError``) if none is approved — the media
    graph renders nothing from an unapproved script (constitution §5). spec 014 T1: when
    ``feature_id`` is given (generate-demo triggered for a specific approved feature), the lookup
    is scoped to that feature's demo_script. Returns ``(artifact_id, title, body_markdown,
    feature_id)``."""
    return reader.load_approved_demo_script(release_run_id, feature_id)


# --- T2 — generate + validate click-path ------------------------------------------

_CLICKPATH_SYSTEM = (
    "You convert an approved product demo script into a deterministic browser click-path for "
    "an automated screen capture of a SYNTHETIC fixture app. Emit ONLY steps using these "
    "actions: navigate (target = a relative app path like /releases), click, fill (target = "
    "the fixture text to type), wait_for_selector, expect_text. Every click/fill/"
    "wait_for_selector/expect_text step MUST include a simple CSS selector (id, class, tag, or "
    '[data-testid="…"]). Never emit scripts, javascript: URLs, absolute/remote URLs, or any '
    "other action. Add a short narration line per step. Return strict JSON matching the schema."
)
_CLICKPATH_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "steps": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "action": {"type": "string"},
                    "selector": {"type": "string"},
                    "target": {"type": "string"},
                    "narration": {"type": "string"},
                },
                "required": ["action"],
            },
        }
    },
    "required": ["steps"],
}


def _clickpath_idempotency_key(artifact_id: str, body_markdown: str) -> str:
    """Deterministic dedupe key for one click-path generation call (aws-bedrock-rules: Converse
    has no idempotency of its own). Same demo script → same key, so a retried job neither
    re-bills nor double-generates."""
    digest = hashlib.sha256()
    digest.update(artifact_id.encode("utf-8"))
    digest.update(b"\x00")
    digest.update(body_markdown.encode("utf-8"))
    return digest.hexdigest()


def generate_click_path_json(
    source_artifact_id: str,
    demo_script_body: str,
    model_client: ModelClient,
) -> GeneratedClickPath:
    """Generate a click-path from the approved demo script via Bedrock Converse (T2, PRD §5.4).

    The response is *structurally* validated through ``GeneratedClickPath`` (untrusted model
    output); a malformed payload fails closed as ``MalformedClickPathError`` without echoing the
    content. Structural validity is NOT safety — ``validate_click_path`` applies the strict
    allowlist next. The path is not executed here."""
    messages = [{"role": "user", "content": demo_script_body}]
    raw = model_client.generate_json(
        "generate_click_path",
        _CLICKPATH_SYSTEM,
        messages,
        _CLICKPATH_SCHEMA,
        _clickpath_idempotency_key(source_artifact_id, demo_script_body),
    )
    try:
        return GeneratedClickPath.model_validate(raw)
    except ValidationError as err:
        raise MalformedClickPathError() from err


def validate_click_path(generated: GeneratedClickPath) -> ValidatedClickPath:
    """Strict-validate a click-path before any execution, minting a ``ValidatedClickPath`` (T2).

    The safety gate (the AC: "an invalid/malicious click-path is rejected and never reaches
    Playwright"). Rejects — by raising ``ClickPathValidationError`` — on: an empty path, more
    than ``MAX_STEPS`` steps, an unknown action, a selector-requiring action with a missing or
    unsafe selector, or a navigate step with a missing/unsafe (absolute/scheme) target. The
    error names the rule + step index but never echoes the offending value (constitution §5).
    Only a fully-safe path returns; nothing downstream can execute an unvalidated path."""
    steps = generated.steps
    if not steps:
        raise ClickPathValidationError(0, "empty click-path")
    if len(steps) > MAX_STEPS:
        raise ClickPathValidationError(len(steps), "too many steps")

    validated: list[ClickStep] = []
    for index, step in enumerate(steps):
        try:
            action = ClickAction(step.action.strip().lower())
        except ValueError:
            # Unknown/forbidden action (e.g. a smuggled "evaluate") — reject the whole path.
            raise ClickPathValidationError(index, "unknown action") from None

        if action in SELECTOR_ACTIONS:
            if step.selector is None or not step.selector.strip():
                raise ClickPathValidationError(index, "missing selector")
            if not is_safe_selector(step.selector):
                raise ClickPathValidationError(index, "unsafe selector")

        if action is ClickAction.NAVIGATE:
            if step.target is None or not step.target.strip():
                raise ClickPathValidationError(index, "missing navigation target")
            if not is_safe_target_path(step.target):
                raise ClickPathValidationError(index, "unsafe navigation target")

        validated.append(
            ClickStep(
                action=action,
                selector=step.selector,
                target=step.target,
                narration=step.narration,
            )
        )
    return ValidatedClickPath(steps=tuple(validated))


# --- T3 — run Playwright capture (validated path only) ----------------------------


def run_playwright_capture(
    click_path: ValidatedClickPath, capturer: PlaywrightCapturer
) -> CaptureResult:
    """Execute the VALIDATED click-path with Playwright on the runner (T3, PRD §5.4).

    The parameter type is ``ValidatedClickPath`` — an unvalidated/rejected path is not even
    representable here, so a malicious click-path can never reach the browser (the AC). The
    capturer drives only the synthetic fixture app (constitution §1: no PII in capture)."""
    return capturer.capture(click_path)


# --- T4 — generate narration (ElevenLabs, content-hash idempotent) ----------------


def narration_content_hash(text: str, config: NarrationConfig) -> str:
    """Deterministic idempotency key for one narration: hash of (text + voice_id + model_id +
    output_format) (elevenlabs-rules: TTS has no idempotency header — enforce it). A change to
    the text OR any voice/model/format param yields a different hash (a different asset)."""
    digest = hashlib.sha256()
    for part in (text, config.voice_id, config.model_id, config.output_format):
        digest.update(part.encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


def generate_narration(
    narration_text: str,
    synthesizer: NarrationSynthesizer,
    config: NarrationConfig,
) -> NarrationResult:
    """Synthesize narration from the approved demo script (T4, PRD §5.4).

    Computes the content-hash idempotency key and hands it to the synthesizer, which dedupes on
    it (same input → same audio, no second bill). The runtime synthesizer reads
    ``ELEVENLABS_API_KEY`` at call time, bounds concurrency below the tier cap, and branches on
    429 codes (elevenlabs-rules); the CI stub returns deterministic materialized audio. The
    result MUST be materialized before ffmpeg (asserted in ``assemble_video_ffmpeg``)."""
    content_hash = narration_content_hash(narration_text, config)
    return synthesizer.synthesize(narration_text, content_hash, config)


# --- T5 — assemble (ffmpeg) → store (S3) → persist (Aurora) ------------------------


def assemble_video_ffmpeg(
    capture: CaptureResult,
    narration: NarrationResult,
    assembler: VideoAssembler,
) -> AssembledMedia:
    """Assemble the capture + narration into final media with ffmpeg (T5, PRD §5.4).

    elevenlabs-rules / the AC: REFUSES to run until the narration audio is fully materialized —
    a partial/streamed response yields truncated/corrupt audio, so we fail fast with a clear
    error rather than muxing a broken file."""
    if not narration.materialized:
        raise ValueError(
            "narration audio is not fully materialized; refusing ffmpeg assembly"
        )
    return assembler.assemble(capture, narration)


def store_media_s3(
    release_run_id: str,
    media_id: str,
    media: AssembledMedia,
    store: MediaStore,
) -> str:
    """Upload the assembled media to S3 and return its ``s3://`` URI (T5, PRD §5.4).

    s3-rules: the store writes a private, server-side-encrypted, run-scoped sanitized key; the
    UI reaches the object only via a server-minted presigned URL (the Next.js layer), never a
    public object."""
    return store.store(release_run_id, media_id, media)


def persist_media_asset(
    media_id: str,
    release_run_id: str,
    source_artifact_id: str | None,
    feature_id: str | None,
    media_type: str,
    s3_uri: str,
    media: AssembledMedia,
    narration: NarrationResult,
    click_path: ValidatedClickPath,
    sink: MediaAssetSink,
    transcript: str | None = None,
    raw_s3_uri: str | None = None,
) -> MediaAsset:
    """Persist the ``media_assets`` row (T5, PRD §5.4 / migration 0007).

    Only the S3 URI + provenance are written (the binary stays in S3, constitution §4). The
    provenance is the §18.3 audit trail: the source demo_script artifact, the validated
    click-path hash Playwright executed, the narration content hash (the ElevenLabs idempotency
    key), and the voice/model ids — so the rendered media is traceable to its approved source +
    inputs. spec 014 T3/§16.3 — ``raw_s3_uri`` records the SEPARATELY-stored raw recording's key
    in the provenance, and ``transcript`` preserves the narrated script. Returns the ``MediaAsset``."""
    provenance = {
        "source_artifact_id": source_artifact_id or "",
        "clickpath_hash": _click_path_hash(click_path),
        "narration_content_hash": narration.content_hash,
        "voice_id": narration.voice_id,
        "model_id": narration.model_id,
        "output_format": narration.output_format,
        "prompt_version": CLICKPATH_PROMPT_VERSION,
    }
    if raw_s3_uri:
        provenance["raw_s3_uri"] = raw_s3_uri
    asset = MediaAsset(
        media_id=media_id,
        release_run_id=release_run_id,
        feature_id=feature_id,
        source_artifact_id=source_artifact_id,
        media_type=media_type,
        s3_uri=s3_uri,
        content_type=media.content_type,
        duration_seconds=media.duration_seconds,
        transcript=transcript,
        status="ready",
        provenance=provenance,
    )
    sink.insert_media_asset(asset)
    return asset


# --- T3 (spec 014) — store the raw recording separately; persist a broken-step asset ----------


def store_raw_recording(
    release_run_id: str,
    media_id: str,
    capture: CaptureResult,
    store: MediaStore,
) -> str:
    """Upload the raw Playwright recording to a SEPARATE S3 key and return its ``s3://`` URI
    (spec 014 T3 / §16.3 "store raw recording and final video separately").

    Run before narration/assembly so the pre-narration capture is durably stored even if a later
    step breaks — the broken-step asset can then point a reviewer at what was captured. s3-rules:
    the store writes a private, SSE, run-scoped sanitized key distinct from the final media key."""
    return store.store_raw(release_run_id, media_id, capture)


def record_broken_step(
    media_id: str,
    release_run_id: str,
    source_artifact_id: str | None,
    feature_id: str | None,
    broken_step: str,
    failure_detail: str,
    sink: MediaAssetSink,
    raw_s3_uri: str | None = None,
    transcript: str | None = None,
) -> MediaAsset:
    """Persist a §16.3 BROKEN media asset that names the step that failed (spec 014 T3).

    Instead of letting a media-step failure fail the whole run opaquely, the graph routes here and
    records a ``status='broken'`` row whose ``provenance`` (the §10.6 ``metadata_json``) carries the
    broken step name + a USER-SAFE failure summary (never the offending model output / selector —
    constitution §5). ``s3_uri`` is the separately-stored raw recording if capture had succeeded,
    else ``None`` (the 0013 CHECK permits a null s3_uri only for a broken row). ``transcript``
    preserves the narration script when narration had completed before the break. The dashboard
    renders this row's broken state + step (spec 014 T4)."""
    provenance = {
        "source_artifact_id": source_artifact_id or "",
        "broken_step": broken_step,
        "failure": failure_detail,
        "prompt_version": CLICKPATH_PROMPT_VERSION,
    }
    if raw_s3_uri:
        provenance["raw_s3_uri"] = raw_s3_uri
    asset = MediaAsset(
        media_id=media_id,
        release_run_id=release_run_id,
        feature_id=feature_id,
        source_artifact_id=source_artifact_id,
        media_type=MEDIA_TYPE_DEMO_VIDEO,
        s3_uri=raw_s3_uri,  # the raw recording if we got that far, else None (broken-before-capture)
        content_type=None,
        duration_seconds=None,
        transcript=transcript,
        status=MEDIA_STATUS_BROKEN,
        provenance=provenance,
    )
    sink.insert_media_asset(asset)
    return asset


def _click_path_hash(click_path: ValidatedClickPath) -> str:
    """Deterministic hash of the validated click-path (the exact step sequence executed) for
    the provenance trail — reproducible from the same path."""
    digest = hashlib.sha256()
    for step in click_path.steps:
        digest.update(step.action.value.encode("utf-8"))
        digest.update(b"\x00")
        digest.update((step.selector or "").encode("utf-8"))
        digest.update(b"\x00")
        digest.update((step.target or "").encode("utf-8"))
        digest.update(b"\x01")
    return digest.hexdigest()
