"""Shared Bedrock resilience helpers: bounded socket-timeout config + throttle retry.

Extracted (staff-review finding: resilience of external calls) so every Bedrock surface —
Converse generation, Titan embeddings, and ApplyGuardrail — shares ONE retry policy and ONE
timeout config instead of each re-implementing it (Converse had backoff; embeddings and the
Guardrail scan had neither, so a single ThrottlingException aborted the phase, and no call had a
socket timeout so a hung connection blocked a graph node indefinitely).

aws-bedrock-rules: handle ThrottlingException with exponential backoff + jitter, and bound every
network call with connect/read timeouts. Retries are owned HERE (botocore's own retries are
disabled in the client config) so there is a single source of retry truth and no double backoff.
"""

from __future__ import annotations

import logging
import random
import time
from collections.abc import Callable
from typing import TypeVar

from botocore.config import Config
from botocore.exceptions import (
    ClientError,
    ConnectTimeoutError,
    EndpointConnectionError,
    ReadTimeoutError,
)
from botocore.exceptions import (
    ConnectionError as BotoConnectionError,
)

logger = logging.getLogger("release_worker.bedrock")

# Socket/endpoint failures (read/connect timeout, connection reset, DNS) are transient: botocore's
# own retries are disabled, so a hung or dropped Bedrock connection would otherwise abort the graph
# node. These are NOT ClientError subclasses, so they must be caught separately and retried.
_RETRYABLE_NETWORK_ERRORS = (
    ReadTimeoutError,
    ConnectTimeoutError,
    EndpointConnectionError,
    BotoConnectionError,
)

_MAX_ATTEMPTS = 5
_BASE_BACKOFF_SECONDS = 0.5
_BACKOFF_CAP_SECONDS = 16.0

# Bound every Bedrock socket: a hung connection must fail fast rather than block a graph node
# forever. read_timeout is generous for slow large-context generations. botocore's own retries
# are disabled (max_attempts=0) so call_with_throttle_retry is the single retry authority.
_CONNECT_TIMEOUT_SECONDS = 10
_READ_TIMEOUT_SECONDS = 120

_T = TypeVar("_T")


def bedrock_client_config() -> Config:
    """botocore Config bounding socket timeouts; retries delegated to call_with_throttle_retry."""
    return Config(
        connect_timeout=_CONNECT_TIMEOUT_SECONDS,
        read_timeout=_READ_TIMEOUT_SECONDS,
        retries={"max_attempts": 0},
    )


def jittered_backoff(attempt: int, rand_fraction: float | None = None) -> float:
    """Exponential backoff with full jitter, capped (aws-bedrock-rules).

    The delay is ``ceiling * rand_fraction`` where ``ceiling`` is the capped exponential.
    ``rand_fraction`` (0..1) defaults to a fresh ``random.random()`` draw so production gets
    REAL per-attempt jitter (no thundering herd under ThrottlingException); tests inject a
    fixed value to keep the delay deterministic. A function-call default would be evaluated
    once at import and freeze the jitter, so the draw happens here on every call instead.
    """
    if rand_fraction is None:
        rand_fraction = random.random()
    ceiling = min(_BACKOFF_CAP_SECONDS, _BASE_BACKOFF_SECONDS * (2**attempt))
    return ceiling * rand_fraction


def _is_throttling(err: ClientError) -> bool:
    return err.response.get("Error", {}).get("Code", "") == "ThrottlingException"


def call_with_throttle_retry(operation: Callable[[], _T], *, what: str) -> _T:
    """Run ``operation`` (one Bedrock API call), retrying ThrottlingException with jittered
    backoff up to ``_MAX_ATTEMPTS`` attempts. Non-throttle ``ClientError``s propagate at once.
    A transient socket/endpoint failure (read/connect timeout, connection reset, DNS) is also
    retried with the same backoff; any other error (including a non-throttle ``ClientError``)
    propagates at once. ``what`` names the call for the (no-PII) backoff log line."""
    last_error: Exception | None = None
    for attempt in range(_MAX_ATTEMPTS):
        try:
            return operation()
        except ClientError as err:
            if not _is_throttling(err) or attempt == _MAX_ATTEMPTS - 1:
                raise
            last_error = err
            delay = jittered_backoff(attempt)
            logger.warning("%s throttled; backing off %.2fs", what, delay)
            time.sleep(delay)
        except _RETRYABLE_NETWORK_ERRORS as err:
            if attempt == _MAX_ATTEMPTS - 1:
                raise
            last_error = err
            delay = jittered_backoff(attempt)
            logger.warning("%s connection error; backing off %.2fs", what, delay)
            time.sleep(delay)
    # Unreachable: the loop either returns or raises, but keep type-checkers happy.
    raise RuntimeError(f"{what} exhausted retries") from last_error
