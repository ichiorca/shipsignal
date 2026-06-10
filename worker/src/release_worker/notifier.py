"""T1/T2/T4 (spec 020) — Slack incoming-webhook dispatch for gate-ready notifications.

All three approval gates are hard LangGraph interrupts, and approval latency is a tracked
product metric (PRD §17.1) — but until this module, no human was told a gate opened. The
dispatcher posts a metadata-only message (``notification_models.GateNotification``) to the
``SLACK_WEBHOOK_URL`` incoming webhook when a gate interrupt fires or a run fails.

Spec ACs honoured here:

* Idempotent (AC3): the ledger is checked before sending — a resumed/replayed graph that
  re-raises the same interrupt is a no-op. Redelivery after a transient HTTP failure
  reuses the same (run, gate) row, bumping attempt_count.
* Never fails the run (AC4): transport errors are caught NARROWLY (urllib's
  HTTPError/URLError + TimeoutError), recorded on the ledger row, and reported as a
  ``DispatchResult`` — the caller's interrupt proceeds normally, same graceful-degradation
  pattern as broken media steps (spec 014 T3).
* Fully off when unset (AC5): a missing/blank ``SLACK_WEBHOOK_URL`` short-circuits to
  ``DISABLED`` before any I/O. The URL embeds a credential, so it is never logged and
  never written to the ledger (P5; elevenlabs/s3 rules' secret posture).

Stdlib only (urllib) — no new dependency (dependency-policy), and the transport seam is
injected so the unit gate exercises every branch without a network
(``worker/tests/test_notifier.py``).
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from enum import StrEnum
from typing import Protocol

from release_worker.notification_models import (
    GateNotification,
    GateNotificationLedger,
    slack_message_text,
)

logger = logging.getLogger("release_worker.notifier")

# Bounded retry, matching the codebase's backoff posture (transient_retry/bedrock_client):
# exponential with full jitter, capped. Notification delivery is best-effort, so the bound
# is small — the run must never wait long on a ping (AC4).
_DEFAULT_ATTEMPTS = 3
_DEFAULT_BASE_DELAY = 0.5
_DEFAULT_CAP = 8.0

# HTTP statuses worth a retry (Slack throttle / transient server error). Any other non-2xx
# (e.g. 400 invalid payload, 403/404 revoked webhook) is permanent — retrying can't help.
_TRANSIENT_STATUSES = frozenset({429, 500, 502, 503, 504})

_REQUEST_TIMEOUT_SECONDS = 10.0


class DispatchResult(StrEnum):
    """Outcome of one dispatch — the caller logs it and moves on (never raises, AC4)."""

    DISABLED = "disabled"  # no webhook configured: feature is off (AC5)
    SKIPPED = "skipped"  # ledger says this (run, gate) was already delivered (AC3)
    SENT = "sent"
    FAILED = "failed"  # attempts exhausted or permanent error; recorded on the ledger


class NotificationTransport(Protocol):
    """POST one JSON body; return the HTTP status. Implementations may raise urllib's
    ``HTTPError``/``URLError`` or ``TimeoutError`` — the dispatcher owns the handling."""

    def post(self, url: str, body: bytes) -> int: ...


class SlackWebhookTransport:
    """Stdlib urllib transport for a Slack incoming webhook (no new dependency)."""

    def post(self, url: str, body: bytes) -> int:
        request = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"}, method="POST"
        )
        with urllib.request.urlopen(  # noqa: S310 — https enforced by resolve_webhook_url
            request, timeout=_REQUEST_TIMEOUT_SECONDS
        ) as response:
            return int(response.status)


def resolve_webhook_url(raw: str | None) -> str | None:
    """Validate the configured webhook URL at the boundary (T4).

    ``None``/blank → the feature is off (AC5: local/dev/CI default). A non-https value is
    a misconfiguration: the URL embeds a credential, so posting it in cleartext is
    forbidden — warn (without echoing the value: it is a secret) and treat as off.
    """
    if raw is None or not raw.strip():
        return None
    url = raw.strip()
    if not url.startswith("https://"):
        logger.warning(
            "SLACK_WEBHOOK_URL is not an https URL; gate notifications are disabled"
        )
        return None
    return url


def _jittered_delay(
    attempt: int, base: float, cap: float, rand_fraction: float
) -> float:
    """Exponential backoff with full jitter, capped (matches transient_retry)."""
    ceiling = min(cap, base * (2**attempt))
    return ceiling * rand_fraction


def dispatch_gate_notification(
    notification: GateNotification,
    webhook_url: str | None,
    ledger: GateNotificationLedger,
    transport: NotificationTransport,
    *,
    attempts: int = _DEFAULT_ATTEMPTS,
    base_delay: float = _DEFAULT_BASE_DELAY,
    cap: float = _DEFAULT_CAP,
    sleep: Callable[[float], None] = time.sleep,
    rand_fraction: float = 0.5,
) -> DispatchResult:
    """Deliver one gate notification, idempotently and without ever raising on I/O.

    The flow per the spec's ACs: webhook unset → DISABLED no-op; ledger already delivered
    → SKIPPED; otherwise POST with bounded jittered retries on transient statuses, record
    every attempt on the ledger row, and stamp ``notified_at`` only on a 2xx. Transport
    errors are caught narrowly (HTTPError/URLError/TimeoutError) — anything else is a real
    bug and surfaces. Logs carry the event + run id only, never the message body or the
    webhook URL (§5; G004 lazy %-style).
    """
    if webhook_url is None:
        return DispatchResult.DISABLED
    run_id, gate = notification.release_run_id, notification.event
    if ledger.already_notified(run_id, gate):
        logger.info(
            "notification for run %s gate %s already sent; skipping", run_id, gate
        )
        return DispatchResult.SKIPPED

    body = json.dumps({"text": slack_message_text(notification)}).encode("utf-8")
    for attempt in range(attempts):
        status: int | None = None
        # Secret-free machine label for the ledger: class name / HTTP status only — an
        # exception message could embed the webhook URL (it is a credential).
        error: str | None = None
        try:
            status = transport.post(webhook_url, body)
        except urllib.error.HTTPError as err:
            status = int(err.code)
            error = f"HTTP {err.code}"
        except (urllib.error.URLError, TimeoutError) as err:
            error = type(err).__name__
        if status is not None and 200 <= status < 300:
            ledger.record_attempt(run_id, gate, status, None)
            ledger.mark_notified(run_id, gate)
            logger.info("notified reviewers for run %s gate %s", run_id, gate)
            return DispatchResult.SENT
        if error is None:
            error = f"HTTP {status}"
        ledger.record_attempt(run_id, gate, status, error)
        retryable = status is None or status in _TRANSIENT_STATUSES
        if not retryable or attempt == attempts - 1:
            break
        sleep(_jittered_delay(attempt, base_delay, cap, rand_fraction))

    # Graceful degradation (AC4): the interrupt proceeds; the ledger row holds the trail.
    logger.warning(
        "notification for run %s gate %s was not delivered (%s); run proceeds",
        run_id,
        gate,
        error,
    )
    return DispatchResult.FAILED
