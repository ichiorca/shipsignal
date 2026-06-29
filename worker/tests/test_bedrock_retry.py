"""Resilience unit: the shared Bedrock throttle/backoff helper (bedrock_retry).

Proves the jitter fix — production no longer waits exactly half the ceiling on every retry
(a thundering herd under ThrottlingException). The random source is injectable so the test
stays deterministic (testing-discipline: no wall-clock / no real randomness dependence).
"""

from __future__ import annotations

from release_worker import bedrock_retry
from release_worker.bedrock_retry import jittered_backoff


def test_injected_rand_fraction_scales_the_ceiling() -> None:
    """A pinned fraction is deterministic: delay == ceiling * fraction (capped exponential)."""
    # ceiling(attempt=0) = 0.5 * 2**0 = 0.5
    assert jittered_backoff(0, 0.5) == 0.25
    # ceiling(attempt=2) = 0.5 * 2**2 = 2.0
    assert jittered_backoff(2, 1.0) == 2.0
    # ceiling is capped at 16.0 (attempt 10 would be huge); fraction 1.0 → exactly the cap.
    assert jittered_backoff(10, 1.0) == 16.0


def test_default_uses_real_randomness_and_is_non_constant(monkeypatch) -> None:
    """Default path draws random.random() each call, so the SAME attempt yields varying delays —
    not a frozen 0.5 * ceiling. The draw is per-call, never frozen at import."""
    draws = iter([0.1, 0.9])
    monkeypatch.setattr(bedrock_retry.random, "random", lambda: next(draws))
    # ceiling(attempt=0) = 0.5; scaled by the two distinct draws.
    first = jittered_backoff(0)
    second = jittered_backoff(0)
    assert first == 0.05
    assert second == 0.45
    assert first != second  # jitter actually varies (no thundering herd)


def test_default_jitter_stays_within_zero_and_ceiling() -> None:
    """Across many real draws the delay is always in [0, ceiling) — a valid full-jitter window."""
    ceiling = min(16.0, 0.5 * 2**1)
    for _ in range(200):
        delay = jittered_backoff(1)
        assert 0.0 <= delay < ceiling
