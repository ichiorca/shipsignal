"""Resilience unit: the runtime ffmpeg assembly adapter's argv.

Proves the truncation fix — the captured video is a FIXED len(steps)*2s clip, so the old bare
``-shortest`` cut a longer narration mid-sentence. The video stream is now padded (last frame
cloned indefinitely) so the FINITE audio is the only terminating stream: the assembled MP4 runs
for the full narration and the audio is never truncated. subprocess is stubbed (no real ffmpeg).
"""

from __future__ import annotations

from pathlib import Path

from release_worker import ffmpeg_assembler
from release_worker.ffmpeg_assembler import FfmpegVideoAssembler
from release_worker.media_models import CaptureResult, NarrationResult


def _capture() -> CaptureResult:
    return CaptureResult(
        video_local_path="/work/capture.webm",
        frames=(),
        duration_seconds=8.0,
        step_count=4,
    )


def _narration() -> NarrationResult:
    return NarrationResult(
        content_hash="h",
        audio_local_path="/work/narration.mp3",
        voice_id="v",
        model_id="m",
        output_format="mp3_44100_128",
        char_count=42,
        materialized=True,
    )


def _run_assemble(tmp_path: Path, monkeypatch) -> list[str]:
    captured: dict[str, list[str]] = {}

    def fake_run(args, **kwargs):  # noqa: ANN001, ANN003 - test stub mirrors subprocess.run
        captured["args"] = list(args)

        class _Completed:
            returncode = 0

        return _Completed()

    monkeypatch.setattr(ffmpeg_assembler.subprocess, "run", fake_run)
    assembler = FfmpegVideoAssembler(work_dir=tmp_path)
    assembler.assemble(_capture(), _narration(), "media-1")
    return captured["args"]


def test_video_is_padded_so_audio_is_never_truncated(tmp_path: Path, monkeypatch) -> None:
    args = _run_assemble(tmp_path, monkeypatch)
    # The video stream is padded by cloning its last frame indefinitely, making the audio the
    # only finite (terminating) stream — so the output spans the FULL narration.
    assert "-vf" in args
    vf = args[args.index("-vf") + 1]
    assert "tpad" in vf
    assert "stop_mode=clone" in vf
    assert "stop=-1" in vf  # infinite pad → video can never be the shorter stream


def test_audio_path_is_an_input_and_reencoded(tmp_path: Path, monkeypatch) -> None:
    args = _run_assemble(tmp_path, monkeypatch)
    assert "/work/narration.mp3" in args  # the full materialized audio is muxed
    assert args[args.index("-c:a") + 1] == "aac"


def test_output_path_is_per_media(tmp_path: Path, monkeypatch) -> None:
    args = _run_assemble(tmp_path, monkeypatch)
    assert args[-1] == str(tmp_path / "media-1.mp4")
