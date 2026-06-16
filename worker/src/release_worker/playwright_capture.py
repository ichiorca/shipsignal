"""T3 (spec 008) — runtime Playwright capture adapter (PRD §5.4 run_playwright_capture).

P1 (Substrate) + constitution §1: browser capture runs ONLY on the GitHub Actions runner via
Playwright; the Vercel app never executes it. It is given a ``ValidatedClickPath`` (the strict
allowlist already passed in ``validate_click_path``), so it only ever executes safe, enumerated
actions against the SYNTHETIC fixture app — never model-emitted code, never real/PII data
(constitution §5). Imported only by ``__main__`` at runtime (needs playwright); the unit gate
uses ``InMemoryPlaywrightCapturer`` so no browser launches in tests.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from release_worker.media_models import (
    CaptureFrame,
    CaptureResult,
    ClickAction,
    ValidatedClickPath,
)

# Each step is allotted this wall-clock budget for screenshots/timeline (deterministic capture).
_STEP_SECONDS = 2.0
_DEFAULT_TIMEOUT_MS = 10_000


class PlaywrightDemoCapturer:
    """Drive the synthetic fixture app through a validated click-path and capture frames."""

    def __init__(self, base_url: str, work_dir: Path) -> None:
        self._base_url = base_url.rstrip("/")
        self._work_dir = work_dir

    @classmethod
    def from_env(cls) -> PlaywrightDemoCapturer:
        # The fixture app URL is config — the capture targets a synthetic app, not production.
        base_url = os.environ.get("DEMO_FIXTURE_BASE_URL", "http://localhost:3000")
        work_dir = Path(os.environ.get("MEDIA_WORK_DIR", "/tmp")) / "capture"
        work_dir.mkdir(parents=True, exist_ok=True)
        return cls(base_url=base_url, work_dir=work_dir)

    def capture(self, click_path: ValidatedClickPath) -> CaptureResult:
        # Lazy import so module load never requires the heavy browser dep; only the runner has it.
        from playwright.sync_api import sync_playwright

        # Isolate each capture in its OWN subdirectory so a prior run's frames/video can never
        # leak into this result (the work dir is reused across captures), and a partial failure
        # cannot return a stale recording.
        frames_dir = Path(tempfile.mkdtemp(prefix="capture-", dir=self._work_dir))
        frames: list[CaptureFrame] = []

        with sync_playwright() as pw:
            browser = pw.chromium.launch(
                headless=True,
                # CI runners (Docker) default /dev/shm to 64MB; without this flag Chromium can
                # crash or emit corrupt frames mid-capture. Standard headless-CI hardening.
                args=["--disable-dev-shm-usage"],
            )
            context = browser.new_context(
                record_video_dir=str(frames_dir),
                viewport={"width": 1280, "height": 720},
            )
            page = context.new_page()
            page.set_default_timeout(_DEFAULT_TIMEOUT_MS)
            video = page.video  # type: ignore[attr-defined]
            try:
                for index, step in enumerate(click_path.steps):
                    self._run_step(page, step)
                    shot = frames_dir / f"frame-{index:03d}.png"
                    page.screenshot(path=str(shot))
                    frames.append(CaptureFrame(step_index=index, local_path=str(shot)))
            finally:
                context.close()  # flush the recorded video
                browser.close()

        # Playwright mints a hashed video filename — resolve the ACTUAL path rather than assuming
        # a fixed name, and fail fast if no file was produced instead of returning a dangling path.
        video_local_path = (
            video.path() if video is not None else str(frames_dir / "capture.webm")  # type: ignore[attr-defined]
        )
        if not Path(video_local_path).exists():
            raise RuntimeError("Playwright capture produced no video file")

        return CaptureResult(
            video_local_path=str(video_local_path),
            frames=tuple(frames),
            duration_seconds=len(click_path.steps) * _STEP_SECONDS,
            step_count=len(click_path.steps),
        )

    def _run_step(self, page: object, step: object) -> None:
        """Dispatch one validated step. Every branch maps to an enumerated ``ClickAction`` —
        there is no eval/script path, so nothing model-emitted is ever executed."""
        action = step.action  # type: ignore[attr-defined]
        if action is ClickAction.NAVIGATE:
            page.goto(f"{self._base_url}{step.target}")  # type: ignore[attr-defined]
        elif action is ClickAction.CLICK:
            page.click(step.selector)  # type: ignore[attr-defined]
        elif action is ClickAction.FILL:
            page.fill(step.selector, step.target or "")  # type: ignore[attr-defined]
        elif (
            action is ClickAction.WAIT_FOR_SELECTOR or action is ClickAction.EXPECT_TEXT
        ):
            page.wait_for_selector(step.selector)  # type: ignore[attr-defined]
