"""T2 (spec 012) — transient-failure retry classifier + backoff loop.

Proves the resume-robustness contract: a transient blip is retried (idempotent re-entry),
a real error surfaces immediately, and retries are bounded. Backoff sleep is injected so
the test is deterministic (testing-discipline: no wall-clock dependence).
"""

from __future__ import annotations

import pytest

from release_worker import transient_retry
from release_worker.transient_retry import is_transient_error, with_retries


class _ClientError(Exception):
    """Stand-in for botocore ClientError: carries a ``response`` dict."""

    def __init__(self, code: str | None = None, status: int | None = None) -> None:
        super().__init__(code or str(status))
        error: dict[str, object] = {}
        if code is not None:
            error["Code"] = code
        meta = {"HTTPStatusCode": status} if status is not None else {}
        self.response = {"Error": error, "ResponseMetadata": meta}


class _HttpError(Exception):
    """Stand-in for urllib HTTPError: carries a numeric ``code``."""

    def __init__(self, code: int) -> None:
        super().__init__(str(code))
        self.code = code


def test_classifies_bedrock_throttling_as_transient() -> None:
    assert is_transient_error(_ClientError(code="ThrottlingException")) is True


def test_classifies_s3_slowdown_as_transient() -> None:
    assert is_transient_error(_ClientError(code="SlowDown")) is True


def test_classifies_http_5xx_and_429_as_transient() -> None:
    assert is_transient_error(_HttpError(503)) is True
    assert is_transient_error(_HttpError(429)) is True
    assert is_transient_error(_ClientError(status=502)) is True


def test_classifies_timeout_as_transient() -> None:
    assert is_transient_error(TimeoutError("read timed out")) is True


def test_does_not_classify_a_real_error_as_transient() -> None:
    # A bad-request / validation error must surface, never be retried (no masking bugs).
    assert is_transient_error(_ClientError(code="ValidationException")) is False
    assert is_transient_error(_HttpError(400)) is False
    assert is_transient_error(ValueError("bad json")) is False


def test_retries_transient_then_succeeds() -> None:
    calls = {"n": 0}
    slept: list[float] = []

    def flaky() -> str:
        calls["n"] += 1
        if calls["n"] < 3:
            raise _ClientError(code="ThrottlingException")
        return "ok"

    result = with_retries(flaky, sleep=slept.append, base_delay=0.1, rand_fraction=1.0)

    assert result == "ok"
    assert calls["n"] == 3
    assert len(slept) == 2  # two backoffs before the third (successful) attempt


def test_non_transient_error_is_not_retried() -> None:
    calls = {"n": 0}

    def boom() -> str:
        calls["n"] += 1
        raise ValueError("real bug")

    with pytest.raises(ValueError, match="real bug"):
        with_retries(boom, sleep=lambda _d: None)
    assert calls["n"] == 1  # surfaced on the first attempt, no retry


def test_gives_up_after_attempts_exhausted() -> None:
    calls = {"n": 0}

    def always_throttled() -> str:
        calls["n"] += 1
        raise _ClientError(code="ThrottlingException")

    with pytest.raises(_ClientError):
        with_retries(always_throttled, attempts=3, sleep=lambda _d: None)
    assert calls["n"] == 3


def test_idempotent_success_returns_without_sleeping() -> None:
    slept: list[float] = []
    result = with_retries(lambda: 42, sleep=slept.append)
    assert result == 42
    assert slept == []  # no transient error → no backoff


def test_injected_rand_fraction_scales_the_delay() -> None:
    """A pinned rand_fraction makes the backoff deterministic: delay == ceiling * fraction."""
    slept: list[float] = []
    calls = {"n": 0}

    def always_throttled() -> str:
        calls["n"] += 1
        raise _ClientError(code="ThrottlingException")

    with pytest.raises(_ClientError):
        with_retries(
            always_throttled,
            attempts=3,
            base_delay=1.0,
            cap=100.0,
            sleep=slept.append,
            rand_fraction=0.5,
        )
    # ceilings = 1*2**0, 1*2**1 → [1.0, 2.0]; scaled by 0.5 → [0.5, 1.0].
    assert slept == [0.5, 1.0]


def test_default_jitter_is_non_constant_across_attempts(monkeypatch) -> None:
    """Default path (rand_fraction=None) draws fresh randomness per attempt, so two retries at
    the SAME ceiling do not produce identical waits — the thundering-herd fix."""
    draws = iter([0.1, 0.9, 0.3, 0.7])
    monkeypatch.setattr(transient_retry.random, "random", lambda: next(draws))
    slept: list[float] = []
    calls = {"n": 0}

    def always_throttled() -> str:
        calls["n"] += 1
        raise _ClientError(code="ThrottlingException")

    # base_delay large + cap pins every ceiling to the SAME value, isolating the jitter source.
    with pytest.raises(_ClientError):
        with_retries(
            always_throttled,
            attempts=3,
            base_delay=10.0,
            cap=10.0,
            sleep=slept.append,
        )
    assert slept == [1.0, 9.0]  # 10*0.1, 10*0.9 — varies despite an identical ceiling
    assert slept[0] != slept[1]
