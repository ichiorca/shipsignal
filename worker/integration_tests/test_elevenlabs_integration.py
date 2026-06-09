"""Integration: REAL ElevenLabs TTS via the worker's ``ElevenLabsSynthesizer``.

Double-gated (RUN_INTEGRATION=1 + RUN_ELEVENLABS_INTEGRATION=1) because every run consumes
real credits. Synthesizes one short line and asserts the audio is fully materialized to
disk with non-empty bytes — the exact contract ffmpeg assembly depends on (a partial
stream must never reach the assembler). Keeps the text tiny to minimize cost.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from release_worker.elevenlabs_client import ElevenLabsSynthesizer
from release_worker.media_models import NarrationConfig


def test_elevenlabs_synthesizes_audio(tmp_path, monkeypatch) -> None:
    if os.environ.get("RUN_ELEVENLABS_INTEGRATION") != "1":
        pytest.skip("set RUN_ELEVENLABS_INTEGRATION=1 (real ElevenLabs, uses credits)")
    if not os.environ.get("ELEVENLABS_API_KEY"):
        pytest.skip("ELEVENLABS_API_KEY not set")
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID")
    if not voice_id:
        pytest.skip("ELEVENLABS_VOICE_ID not set")

    # Keep the materialized audio inside the test's tmp dir.
    monkeypatch.setenv("MEDIA_WORK_DIR", str(tmp_path))

    synthesizer = ElevenLabsSynthesizer.from_env()
    config = NarrationConfig(
        voice_id=voice_id,
        model_id=os.environ.get("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2"),
        output_format=os.environ.get("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128"),
    )

    result = synthesizer.synthesize("Integration test.", "it-narration-0001", config)

    assert result.materialized is True
    audio = Path(result.audio_local_path)
    assert audio.exists()
    assert audio.stat().st_size > 0
