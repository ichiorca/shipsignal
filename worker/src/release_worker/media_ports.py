"""T2/T3/T4/T5 (spec 008) — the ports the media_generation_graph nodes depend on, plus
in-memory fakes for the unit gate.

P4 (Storage) + P1 (Substrate): the nodes never import playwright/boto3/elevenlabs/psycopg
directly — they depend on these narrow Protocols. The durable implementations live in
runtime-only modules (``playwright_capture``, ``elevenlabs_client``, ``ffmpeg_assembler``,
``s3_media_store``, ``aurora_media``) imported by ``__main__``, so the unit gate exercises the
pure node logic against the fakes here — no browser, no S3, no ElevenLabs, no DB.

constitution §5: ``DemoScriptReader`` surfaces only a Gate#2-APPROVED demo_script (the media
graph never renders unapproved content). ``NarrationSynthesizer`` reads its key at call time
(elevenlabs-rules) and is content-hash idempotent. ``MediaStore`` writes private, sanitized S3
keys (s3-rules). ``MediaAssetSink`` writes the §18.3 provenance the dashboard preview reads.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from release_worker.media_models import (
    AssembledMedia,
    CaptureResult,
    MediaAsset,
    NarrationConfig,
    NarrationResult,
    ValidatedClickPath,
)


class NoApprovedDemoScriptError(ValueError):
    """Raised when the media graph is reached with no Gate#2-approved demo_script for the run.

    The graph fails closed (it renders nothing) — a demo video is only ever built from an
    approved script (constitution §5). User-safe: echoes no run-specific data."""

    def __init__(self) -> None:
        super().__init__(
            "no approved demo_script for this run; media generation cannot proceed"
        )


@runtime_checkable
class DemoScriptReader(Protocol):
    """Load the run's Gate#2-approved ``demo_script`` artifact (PRD §5.4 load_approved_demo_script).

    MUST return only an artifact whose ``status='approved'`` (constitution §5). Returns the
    ``(artifact_id, title, body_markdown, feature_id)`` the click-path + narration are built
    from, or raises ``NoApprovedDemoScriptError``. ``AuroraDemoScriptReader`` satisfies it at
    runtime."""

    def load_approved_demo_script(
        self, release_run_id: str
    ) -> tuple[str, str, str, str | None]: ...


@runtime_checkable
class PlaywrightCapturer(Protocol):
    """Execute a VALIDATED click-path with Playwright on the Actions runner (PRD §5.4).

    MUST be given a ``ValidatedClickPath`` (the type system makes an unvalidated path
    unrepresentable here) and MUST drive only the synthetic fixture app (constitution §1: no
    real/PII data in capture). Returns the local screenshots + clip. ``PlaywrightDemoCapturer``
    satisfies it at runtime; the unit gate uses ``InMemoryPlaywrightCapturer``."""

    def capture(self, click_path: ValidatedClickPath) -> CaptureResult: ...


@runtime_checkable
class NarrationSynthesizer(Protocol):
    """Synthesize narration audio via ElevenLabs (PRD §5.4 generate_narration).

    elevenlabs-rules: reads ``ELEVENLABS_API_KEY`` at call time (never the browser), is bounded
    below the tier concurrency cap, branches on 429 codes, and is idempotent on the content
    hash of (text + voice_id + model_id + output_format) — the same input returns the same
    cached audio without a second bill. MUST fully materialize the audio to disk before
    returning (``NarrationResult.materialized=True``). ``ElevenLabsSynthesizer`` satisfies it at
    runtime; the unit gate uses ``InMemoryNarrationSynthesizer`` (the CI stub)."""

    def synthesize(
        self, text: str, content_hash: str, config: NarrationConfig
    ) -> NarrationResult: ...


@runtime_checkable
class VideoAssembler(Protocol):
    """Assemble the capture + narration into final media with ffmpeg (PRD §5.4).

    elevenlabs-rules: MUST be called only after the audio is fully materialized (the node
    enforces ``narration.materialized`` before invoking this). ``FfmpegVideoAssembler`` satisfies
    it at runtime; the unit gate uses ``InMemoryVideoAssembler``."""

    def assemble(
        self, capture: CaptureResult, narration: NarrationResult
    ) -> AssembledMedia: ...


@runtime_checkable
class MediaStore(Protocol):
    """Upload assembled media to S3, returning the ``s3://`` URI (PRD §5.4 store_media_s3).

    s3-rules: private bucket, server-side encryption, keys sanitized (no traversal / untrusted
    bucket). The UI reaches the object only via a server-minted presigned URL (the Next.js
    layer), never a public object. ``S3MediaStore`` satisfies it at runtime."""

    def store(
        self,
        release_run_id: str,
        media_id: str,
        media: AssembledMedia,
    ) -> str: ...


@runtime_checkable
class MediaAssetSink(Protocol):
    """Persist a ``media_assets`` row (PRD §5.4 persist_media_asset / migration 0007).

    ``AuroraMediaAssetSink`` satisfies it at runtime."""

    def insert_media_asset(self, asset: MediaAsset) -> None: ...


# --- in-memory fakes (the unit gate; ElevenLabs/Playwright/ffmpeg are STUBBED in CI) --------


class InMemoryDemoScriptReader:
    """In-process ``DemoScriptReader``: returns the seeded approved script, or raises
    ``NoApprovedDemoScriptError`` when seeded with ``None`` (the fail-closed path)."""

    def __init__(self, script: tuple[str, str, str, str | None] | None) -> None:
        self._script = script

    def load_approved_demo_script(
        self, release_run_id: str
    ) -> tuple[str, str, str, str | None]:
        if self._script is None:
            raise NoApprovedDemoScriptError()
        return self._script


class InMemoryPlaywrightCapturer:
    """In-process ``PlaywrightCapturer``: records the click-path it was asked to run (so a test
    can assert ONLY validated paths reach it) and returns a deterministic capture."""

    def __init__(self, result: CaptureResult) -> None:
        self._result = result
        self.captured: list[ValidatedClickPath] = []

    def capture(self, click_path: ValidatedClickPath) -> CaptureResult:
        self.captured.append(click_path)
        return self._result


class InMemoryNarrationSynthesizer:
    """In-process ``NarrationSynthesizer`` (the CI stub): returns a materialized result and
    records every call, deduping on the content hash so a test can prove the same input
    synthesizes once (idempotency) and assert the audio is materialized before ffmpeg."""

    def __init__(self) -> None:
        # One entry per UNIQUE content hash actually synthesized — repeats serve from cache.
        self.synthesized: list[str] = []
        self._cache: dict[str, NarrationResult] = {}

    def synthesize(
        self, text: str, content_hash: str, config: NarrationConfig
    ) -> NarrationResult:
        cached = self._cache.get(content_hash)
        if cached is not None:
            return cached
        self.synthesized.append(content_hash)
        result = NarrationResult(
            content_hash=content_hash,
            audio_local_path=f"/tmp/narration/{content_hash}.{config.output_format}",
            voice_id=config.voice_id,
            model_id=config.model_id,
            output_format=config.output_format,
            char_count=len(text),
            materialized=True,
        )
        self._cache[content_hash] = result
        return result


class InMemoryVideoAssembler:
    """In-process ``VideoAssembler``: records the (capture, narration) it assembled (so a test
    can assert it ran only on materialized audio) and returns a deterministic media file."""

    def __init__(self, content_type: str = "video/mp4") -> None:
        self._content_type = content_type
        self.assembled: list[tuple[CaptureResult, NarrationResult]] = []

    def assemble(
        self, capture: CaptureResult, narration: NarrationResult
    ) -> AssembledMedia:
        self.assembled.append((capture, narration))
        return AssembledMedia(
            local_path=f"{capture.video_local_path}.muxed.mp4",
            content_type=self._content_type,
            duration_seconds=max(capture.duration_seconds, 0.0),
        )


class InMemoryMediaStore:
    """In-process ``MediaStore``: returns a deterministic ``s3://`` URI and records the keys it
    "stored" so a test can assert the key is sanitized + scoped to the run."""

    def __init__(self, bucket: str = "media-bucket") -> None:
        self._bucket = bucket
        self.stored: list[str] = []

    def store(self, release_run_id: str, media_id: str, media: AssembledMedia) -> str:
        key = f"media/{release_run_id}/{media_id}.mp4"
        self.stored.append(key)
        return f"s3://{self._bucket}/{key}"


class InMemoryMediaAssetSink:
    """In-process ``MediaAssetSink``: records inserted media rows so a test can assert the
    provenance + s3_uri persisted."""

    def __init__(self) -> None:
        self.assets: list[MediaAsset] = []

    def insert_media_asset(self, asset: MediaAsset) -> None:
        self.assets.append(asset)
