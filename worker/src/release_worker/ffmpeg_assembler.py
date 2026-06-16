"""T5 (spec 008) — runtime ffmpeg assembly adapter (PRD §5.4 assemble_video_ffmpeg).

P1 (Substrate) + constitution §1: ffmpeg assembly runs ONLY on the GitHub Actions runner. We
own the click-path JSON + the validation; ffmpeg owns the muxing (we never reimplement it). The
``ffmpeg`` binary is invoked via ``subprocess`` (the runner provides it) — no extra Python dep.

elevenlabs-rules: the caller (``assemble_video_ffmpeg`` node) refuses to run until the narration
audio is fully materialized, so by the time we mux, the audio file on disk is complete — never a
partial stream that would yield truncated/corrupt output. Imported only by ``__main__`` at
runtime; the unit gate uses ``InMemoryVideoAssembler``.
"""

from __future__ import annotations

import logging
import os
import subprocess
from pathlib import Path

from release_worker.media_models import AssembledMedia, CaptureResult, NarrationResult

logger = logging.getLogger("release_worker.ffmpeg")

_DEFAULT_CONTENT_TYPE = "video/mp4"


class FfmpegAssemblyError(RuntimeError):
    """Raised when the ffmpeg mux fails. User-safe: names the failure, not the command output."""


class FfmpegVideoAssembler:
    """Mux the captured video clip + narration audio into a final MP4 (PRD §5.4)."""

    def __init__(self, work_dir: Path, ffmpeg_bin: str = "ffmpeg") -> None:
        self._work_dir = work_dir
        self._ffmpeg = ffmpeg_bin

    @classmethod
    def from_env(cls) -> FfmpegVideoAssembler:
        work_dir = Path(os.environ.get("MEDIA_WORK_DIR", "/tmp")) / "assembled"
        work_dir.mkdir(parents=True, exist_ok=True)
        return cls(work_dir=work_dir, ffmpeg_bin=os.environ.get("FFMPEG_BIN", "ffmpeg"))

    def assemble(
        self, capture: CaptureResult, narration: NarrationResult, media_id: str
    ) -> AssembledMedia:
        # Per-media output name: two media runs sharing this work dir (a reused/self-hosted runner)
        # must not clobber each other's demo.mp4 mid-upload. media_id is unique per generation.
        out_path = self._work_dir / f"{media_id}.mp4"
        # -shortest stops at the shorter stream; re-encode audio to AAC for MP4 compatibility.
        args = [
            self._ffmpeg,
            "-y",
            "-i",
            capture.video_local_path,
            "-i",
            narration.audio_local_path,
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-shortest",
            str(out_path),
        ]
        try:
            subprocess.run(  # noqa: S603 - fixed argv, no shell, paths are workspace-local
                args,
                check=True,
                capture_output=True,
                timeout=600,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as err:
            logger.error("ffmpeg assembly failed (%s)", type(err).__name__)
            raise FfmpegAssemblyError(
                "ffmpeg failed to assemble the demo media"
            ) from err

        return AssembledMedia(
            local_path=str(out_path),
            content_type=_DEFAULT_CONTENT_TYPE,
            duration_seconds=capture.duration_seconds,
        )
