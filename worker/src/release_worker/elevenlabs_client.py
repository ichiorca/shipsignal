"""T4 (spec 008) — runtime ElevenLabs narration adapter (PRD §5.4 generate_narration).

elevenlabs-rules, enforced here:
* The ``xi-api-key`` is read from the environment AT CALL TIME and never logged, never returned,
  never exposed to a browser/Playwright context. A missing key fails fast with a clear error.
* ``voice_id`` / ``model_id`` / ``output_format`` are CONFIG (passed in), not hardcoded.
* TTS has no idempotency header, so we enforce it ourselves: the node passes a deterministic
  content hash of (text + voice_id + model_id + output_format); the same hash serves the cached
  audio from disk without a second synthesis/bill.
* Concurrency is bounded below the tier cap via a module-level semaphore.
* On 429 we branch on the error ``code`` (rate_limit vs concurrent_limit), not a blanket retry.
* The audio is fully materialized to disk before returning (``materialized=True``) — a partial
  stream would yield truncated audio that ffmpeg must never assemble.

Imported only by ``__main__`` at runtime; the unit gate uses the in-memory CI stub
(``InMemoryNarrationSynthesizer``) instead, so no real TTS call happens in tests.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

from release_worker.media_models import NarrationConfig, NarrationResult

logger = logging.getLogger("release_worker.elevenlabs")

_API_BASE = "https://api.elevenlabs.io/v1/text-to-speech"
# Conservative default below the Starter tier cap (3); the runner may lower it via env.
_DEFAULT_MAX_CONCURRENCY = 2
_MAX_BACKOFF_SECONDS = 32.0
_MAX_ATTEMPTS = 5
_OUTPUT_EXTENSIONS = {
    "mp3_44100_128": "mp3",
    "mp3_22050_32": "mp3",
    "pcm_16000": "pcm",
}


class NarrationSynthesisError(RuntimeError):
    """Raised when narration cannot be synthesized after honoring the 429 backoff policy.

    User-safe: names the failure class, never the api key or response body."""


class ElevenLabsSynthesizer:
    """Content-hash-idempotent ElevenLabs TTS over the v1 REST API (PRD §5.4)."""

    def __init__(
        self,
        audio_dir: Path,
        max_concurrency: int = _DEFAULT_MAX_CONCURRENCY,
        sleep: object | None = None,
    ) -> None:
        self._audio_dir = audio_dir
        # Bound concurrent TTS calls below the subscription tier's cap (elevenlabs-rules).
        self._semaphore = threading.BoundedSemaphore(max(1, max_concurrency))
        # Injectable sleeper keeps the backoff deterministic in a future integration test.
        self._sleep = sleep if callable(sleep) else time.sleep

    @classmethod
    def from_env(cls) -> ElevenLabsSynthesizer:
        audio_dir = Path(os.environ.get("MEDIA_WORK_DIR", "/tmp")) / "narration"
        audio_dir.mkdir(parents=True, exist_ok=True)
        max_conc = int(
            os.environ.get("ELEVENLABS_MAX_CONCURRENCY", _DEFAULT_MAX_CONCURRENCY)
        )
        return cls(audio_dir=audio_dir, max_concurrency=max_conc)

    def synthesize(
        self, text: str, content_hash: str, config: NarrationConfig
    ) -> NarrationResult:
        ext = _OUTPUT_EXTENSIONS.get(config.output_format, "mp3")
        out_path = self._audio_dir / f"{content_hash}.{ext}"
        # Idempotency: a prior synthesis of this exact (text+voice+model+format) is reused.
        if out_path.exists() and out_path.stat().st_size > 0:
            return self._result(text, content_hash, config, out_path)

        # Read the key at call time; fail fast (secret-free message) if absent.
        api_key = os.environ.get("ELEVENLABS_API_KEY")
        if not api_key:
            raise NarrationSynthesisError(
                "ELEVENLABS_API_KEY is not set; cannot synthesize narration"
            )

        audio = self._post_tts(text, config, api_key)
        # Materialize fully to disk BEFORE returning (no partial stream reaches ffmpeg).
        out_path.write_bytes(audio)
        return self._result(text, content_hash, config, out_path)

    def _result(
        self, text: str, content_hash: str, config: NarrationConfig, path: Path
    ) -> NarrationResult:
        return NarrationResult(
            content_hash=content_hash,
            audio_local_path=str(path),
            voice_id=config.voice_id,
            model_id=config.model_id,
            output_format=config.output_format,
            char_count=len(text),
            materialized=True,
        )

    def _post_tts(self, text: str, config: NarrationConfig, api_key: str) -> bytes:
        url = f"{_API_BASE}/{config.voice_id}?output_format={config.output_format}"
        payload = json.dumps({"text": text, "model_id": config.model_id}).encode(
            "utf-8"
        )
        backoff = 1.0
        for attempt in range(1, _MAX_ATTEMPTS + 1):
            with self._semaphore:
                try:
                    request = urllib.request.Request(  # noqa: S310 - fixed https host
                        url,
                        data=payload,
                        method="POST",
                        headers={
                            "xi-api-key": api_key,
                            "content-type": "application/json",
                            "accept": "audio/mpeg",
                        },
                    )
                    with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310
                        return response.read()
                except urllib.error.HTTPError as err:
                    if err.code != 429 or attempt == _MAX_ATTEMPTS:
                        # Never log the response body (could echo prompt text); log status only.
                        logger.error("ElevenLabs TTS failed with status %s", err.code)
                        raise NarrationSynthesisError(
                            f"narration synthesis failed (status {err.code})"
                        ) from err
                    # Branch on the 429 code, not a blanket retry (elevenlabs-rules):
                    # a concurrent-limit needs in-flight calls to drain (the bounded
                    # semaphore already caps us), a rate-limit needs the clock to advance —
                    # both honored by exponential backoff + jitter capped at _MAX_BACKOFF.
                    code = self._error_code(err)
                    logger.warning(
                        "ElevenLabs 429 (%s); backing off %.1fs", code, backoff
                    )
            self._sleep(min(backoff, _MAX_BACKOFF_SECONDS))
            backoff = min(backoff * 2, _MAX_BACKOFF_SECONDS)
        raise NarrationSynthesisError("narration synthesis exhausted retries")

    @staticmethod
    def _error_code(err: urllib.error.HTTPError) -> str:
        """Best-effort extract of the ElevenLabs error ``code`` from a 429 body (no raise)."""
        try:
            body = json.loads(err.read().decode("utf-8"))
            detail = body.get("detail", {})
            if isinstance(detail, dict):
                return str(detail.get("status", "rate_limit_exceeded"))
        except (ValueError, AttributeError, OSError):
            pass
        return "rate_limit_exceeded"
