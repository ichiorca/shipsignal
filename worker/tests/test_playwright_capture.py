"""Resilience unit: the runtime Playwright capture adapter's step dispatch.

Proves the EXPECT_TEXT fix — the step's expected text (``target``) is now actually asserted
against the matched element instead of being a silent no-op wait (which could never fail a
broken demo). The page is a fake (no real browser launches in the unit gate).
"""

from __future__ import annotations

from pathlib import Path

import pytest

from release_worker.media_models import ClickAction, ClickStep
from release_worker.playwright_capture import PlaywrightDemoCapturer


class _FakeElement:
    def __init__(self, text: str | None) -> None:
        self._text = text

    def text_content(self) -> str | None:
        return self._text


class _FakePage:
    """Minimal duck-typed Playwright page: records selectors waited on, returns a fixed element."""

    def __init__(self, element: _FakeElement | None) -> None:
        self._element = element
        self.waited: list[str] = []

    def wait_for_selector(self, selector: str) -> _FakeElement | None:
        self.waited.append(selector)
        return self._element


def _capturer(tmp_path: Path) -> PlaywrightDemoCapturer:
    return PlaywrightDemoCapturer(base_url="http://localhost:3000", work_dir=tmp_path)


def test_expect_text_passes_when_element_contains_target(tmp_path: Path) -> None:
    page = _FakePage(_FakeElement("Saved successfully — all good"))
    step = ClickStep(action=ClickAction.EXPECT_TEXT, selector=".toast", target="Saved")
    # No exception → the assertion held.
    _capturer(tmp_path)._run_step(page, step)
    assert page.waited == [".toast"]


def test_expect_text_fails_when_target_missing(tmp_path: Path) -> None:
    page = _FakePage(_FakeElement("Something else entirely"))
    step = ClickStep(action=ClickAction.EXPECT_TEXT, selector=".toast", target="Saved")
    with pytest.raises(AssertionError, match="expect_text failed"):
        _capturer(tmp_path)._run_step(page, step)


def test_expect_text_fails_when_element_has_no_text(tmp_path: Path) -> None:
    page = _FakePage(_FakeElement(None))
    step = ClickStep(action=ClickAction.EXPECT_TEXT, selector=".toast", target="Saved")
    with pytest.raises(AssertionError, match="expect_text failed"):
        _capturer(tmp_path)._run_step(page, step)


def test_wait_for_selector_does_not_assert_text(tmp_path: Path) -> None:
    """WAIT_FOR_SELECTOR is unchanged: it only waits; mismatched element text must NOT fail it."""
    page = _FakePage(_FakeElement("irrelevant content"))
    step = ClickStep(
        action=ClickAction.WAIT_FOR_SELECTOR, selector="#ready", target="ignored"
    )
    _capturer(tmp_path)._run_step(page, step)  # no raise
    assert page.waited == ["#ready"]
