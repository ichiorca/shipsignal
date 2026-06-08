"""T2 (spec 012) — transient-failure retry for idempotent loop re-entry.

P5 (Safety rails) + the integration rules (aws-bedrock/github/s3): a release run that
wedges on a transient blip (a Bedrock ``ThrottlingException``, a GitHub/S3 5xx or 429, a
socket timeout) must not strand the operator mid-loop. Because every phase resumes the
SAME checkpointed thread (``loop_orchestration.thread_id_for``), re-invoking a graph is
**idempotent re-entry**: LangGraph replays from the last checkpoint rather than redoing
committed work, so retrying the whole invocation on a transient error is safe.

This module owns the classifier + the backoff loop so the policy is one tested unit. It is
deliberately dependency-free (it inspects exceptions by attribute/duck-typing, never
importing botocore/urllib), so the unit gate covers it without the runtime libs
(``worker/tests/test_transient_retry.py``); ``__main__`` wraps each ``graph.invoke`` with it.

Note: a LangGraph human-gate ``interrupt`` surfaces as a normal return value, NOT an
exception, so wrapping ``invoke`` never retries past a gate (constitution §5: no
auto-satisfied gate).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import TypeVar

logger = logging.getLogger("release_worker.retry")

T = TypeVar("T")

# Defaults mirror the Bedrock client's existing backoff (full jitter, capped) so the loop
# behaves consistently wherever a transient error is retried.
_DEFAULT_ATTEMPTS = 5
_DEFAULT_BASE_DELAY = 0.5
_DEFAULT_CAP = 16.0

# Error codes/markers we treat as transient across Bedrock / GitHub / S3.
_TRANSIENT_CODES = frozenset(
    {
        "ThrottlingException",
        "TooManyRequestsException",
        "RequestTimeout",
        "RequestTimeoutException",
        "ServiceUnavailable",
        "ServiceUnavailableException",
        "InternalServerError",
        "InternalServerException",
        "SlowDown",  # S3 throttle
        "503 SlowDown",
    }
)
_TRANSIENT_STATUSES = frozenset({429, 500, 502, 503, 504})


def is_transient_error(exc: BaseException) -> bool:
    """True if ``exc`` is a retryable transient failure (throttle / 5xx / 429 / timeout).

    Duck-typed so it needs neither botocore nor urllib imported: it reads a botocore
    ``ClientError.response['Error']['Code']``, an HTTP ``status``/``code`` attribute, and
    falls back to the stdlib ``TimeoutError``. A non-transient error (bad request, parse
    failure, auth) returns False so it surfaces immediately — we never mask real bugs.
    """
    if isinstance(exc, TimeoutError):
        return True

    # botocore ClientError shape: exc.response['Error']['Code'].
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        code = response.get("Error", {}).get("Code")
        if isinstance(code, str) and code in _TRANSIENT_CODES:
            return True
        status = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if isinstance(status, int) and status in _TRANSIENT_STATUSES:
            return True

    # urllib HTTPError / generic HTTP wrappers: a numeric status on .code or .status.
    for attr in ("code", "status"):
        value = getattr(exc, attr, None)
        if isinstance(value, int) and value in _TRANSIENT_STATUSES:
            return True

    return False


def _jittered_delay(
    attempt: int, base: float, cap: float, rand_fraction: float
) -> float:
    """Exponential backoff with full jitter, capped (matches bedrock_client)."""
    ceiling = min(cap, base * (2**attempt))
    return ceiling * rand_fraction


def with_retries(
    fn: Callable[[], T],
    *,
    attempts: int = _DEFAULT_ATTEMPTS,
    base_delay: float = _DEFAULT_BASE_DELAY,
    cap: float = _DEFAULT_CAP,
    is_transient: Callable[[BaseException], bool] = is_transient_error,
    sleep: Callable[[float], None] = time.sleep,
    rand_fraction: float = 0.5,
    label: str = "operation",
) -> T:
    """Call ``fn`` retrying only on transient errors with capped jittered backoff.

    Re-raises immediately on a non-transient error or once ``attempts`` is exhausted. The
    ``sleep`` and ``rand_fraction`` are injected so the backoff is deterministic under test.
    ``fn`` must be idempotent — at the call site it is a checkpointed ``graph.invoke``, so
    re-entry replays from the last committed checkpoint (spec 012 T2).
    """
    if attempts < 1:
        raise ValueError("attempts must be >= 1")
    last_error: BaseException | None = None
    for attempt in range(attempts):
        try:
            return fn()
        except BaseException as err:  # noqa: BLE001 — re-raised unless classified transient
            if not is_transient(err) or attempt == attempts - 1:
                raise
            last_error = err
            delay = _jittered_delay(attempt, base_delay, cap, rand_fraction)
            logger.warning(
                "%s hit a transient error (attempt %d/%d); retrying in %.2fs",
                label,
                attempt + 1,
                attempts,
                delay,
            )
            sleep(delay)
    # Unreachable: the loop returns or raises, but keep the type checker satisfied.
    raise RuntimeError(f"{label} exhausted retries") from last_error
