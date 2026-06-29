"""Resilience unit: the runtime ElevenLabs TTS adapter's 429 backoff policy.

Proves the two fixes:
* the backoff is exponential **with jitter** (elevenlabs-rules), not a frozen pure-doubling;
* the 429 handler **really branches on the error code** — a concurrent-limit drains with a
  short bounded wait, a rate-limit climbs the exponential — instead of taking one shared path.

Both the sleeper and the random source are injected so the test is deterministic (no
wall-clock, no real randomness, no real network call — urlopen is stubbed).
"""

from __future__ import annotations

import io
import json
import urllib.error
from pathlib import Path

import pytest

from release_worker import elevenlabs_client
from release_worker.elevenlabs_client import (
    ElevenLabsSynthesizer,
    NarrationSynthesisError,
)
from release_worker.media_models import NarrationConfig

_CONFIG = NarrationConfig(
    voice_id="voice-abc",
    model_id="eleven_multilingual_v2",
    output_format="mp3_44100_128",
)


def _http_429(code_str: str) -> urllib.error.HTTPError:
    """A fresh 429 whose JSON body carries the ElevenLabs error ``code`` (read once)."""
    body = json.dumps({"detail": {"status": code_str}}).encode("utf-8")
    return urllib.error.HTTPError(
        "https://api.elevenlabs.io/x", 429, "Too Many Requests", {}, io.BytesIO(body)
    )


def _synth(tmp_path: Path, slept: list[float], rand_value: float) -> ElevenLabsSynthesizer:
    return ElevenLabsSynthesizer(
        audio_dir=tmp_path,
        sleep=slept.append,
        rand=lambda: rand_value,
    )


def test_rate_limit_429_climbs_exponential_backoff_with_jitter(
    tmp_path: Path, monkeypatch
) -> None:
    """rate_limit_exceeded → exponential ceilings (1,2,4,8) scaled by the injected jitter."""
    slept: list[float] = []
    monkeypatch.setattr(
        elevenlabs_client.urllib.request,
        "urlopen",
        lambda *a, **k: (_ for _ in ()).throw(_http_429("rate_limit_exceeded")),
    )
    synth = _synth(tmp_path, slept, rand_value=0.5)

    with pytest.raises(NarrationSynthesisError, match="status 429"):
        synth._post_tts("hello", _CONFIG, "secret-key")

    # 5 attempts → 4 backoffs; ceilings 1,2,4,8 each * 0.5 jitter.
    assert slept == [0.5, 1.0, 2.0, 4.0]


def test_concurrent_limit_429_uses_short_bounded_wait_not_exponential(
    tmp_path: Path, monkeypatch
) -> None:
    """concurrent_limit_exceeded → a short bounded jittered wait (drain in-flight calls), which
    must NOT climb the exponential the way a rate-limit does."""
    slept: list[float] = []
    monkeypatch.setattr(
        elevenlabs_client.urllib.request,
        "urlopen",
        lambda *a, **k: (_ for _ in ()).throw(_http_429("concurrent_limit_exceeded")),
    )
    synth = _synth(tmp_path, slept, rand_value=1.0)

    with pytest.raises(NarrationSynthesisError, match="status 429"):
        synth._post_tts("hello", _CONFIG, "secret-key")

    # 4 backoffs, all the same short bounded window (1.0 * jitter) — flat, not 1,2,4,8.
    assert slept == [1.0, 1.0, 1.0, 1.0]
    assert slept != [1.0, 2.0, 4.0, 8.0]  # the branch is real, not the rate-limit climb


def test_default_rand_is_injectable_and_jitter_is_applied(
    tmp_path: Path, monkeypatch
) -> None:
    """A different jitter fraction scales the same exponential ceiling — proving jitter is live
    (the old code had none: it slept exactly the doubling ceiling every time)."""
    slept: list[float] = []
    monkeypatch.setattr(
        elevenlabs_client.urllib.request,
        "urlopen",
        lambda *a, **k: (_ for _ in ()).throw(_http_429("rate_limit_exceeded")),
    )
    synth = _synth(tmp_path, slept, rand_value=0.25)

    with pytest.raises(NarrationSynthesisError):
        synth._post_tts("hello", _CONFIG, "secret-key")

    # ceilings 1,2,4,8 * 0.25 → quartered, never the bare ceiling.
    assert slept == [0.25, 0.5, 1.0, 2.0]


def test_network_error_retries_with_jittered_backoff(tmp_path: Path, monkeypatch) -> None:
    """A non-HTTP transport error also backs off with jitter, then fails clearly after the cap."""
    slept: list[float] = []
    monkeypatch.setattr(
        elevenlabs_client.urllib.request,
        "urlopen",
        lambda *a, **k: (_ for _ in ()).throw(urllib.error.URLError("conn reset")),
    )
    synth = _synth(tmp_path, slept, rand_value=1.0)

    with pytest.raises(NarrationSynthesisError, match="network error"):
        synth._post_tts("hello", _CONFIG, "secret-key")

    assert slept == [1.0, 2.0, 4.0, 8.0]


def test_backoff_is_capped_at_max(tmp_path: Path) -> None:
    """The exponential ceiling never exceeds the ~32s cap (elevenlabs-rules)."""
    synth = _synth(tmp_path, [], rand_value=1.0)
    # attempt 10 would be 1*2**9 = 512s uncapped; must be clamped to the 32s cap.
    assert synth._backoff_delay(10) == elevenlabs_client._MAX_BACKOFF_SECONDS
