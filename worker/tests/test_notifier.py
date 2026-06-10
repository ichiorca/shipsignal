"""T1/T2/T4 (spec 020) — the gate-notification dispatcher.

Exercises ``dispatch_gate_notification`` through its public surface against the in-memory
ledger + a fake transport: the spec's AC tests — idempotency on replay (AC3),
failure-isolation (a webhook 500 never raises, AC4), the unset-config no-op (AC5) — plus
the bounded-retry trail and the https-only config boundary (T4).
"""

from __future__ import annotations

import urllib.error

from release_worker.notification_models import (
    GateNotification,
    RecordingNotificationLedger,
)
from release_worker.notifier import (
    DispatchResult,
    dispatch_gate_notification,
    resolve_webhook_url,
)

_URL = "https://hooks.slack.com/services/T000/B000/XXXX"


def _notification() -> GateNotification:
    return GateNotification(
        repo="acme/app",
        release_run_id="relrun_001",
        event="feature_manifest_approval",
        pending_count=4,
        dashboard_url="https://app.example.com/releases/relrun_001/review",
    )


class _ScriptedTransport:
    """Fake transport replaying a script of statuses/exceptions, recording each POST."""

    def __init__(self, script: list[int | Exception]) -> None:
        self._script = script
        self.posts: list[tuple[str, bytes]] = []

    def post(self, url: str, body: bytes) -> int:
        self.posts.append((url, body))
        step = self._script[min(len(self.posts), len(self._script)) - 1]
        if isinstance(step, Exception):
            raise step
        return step


def _dispatch(
    transport: _ScriptedTransport,
    ledger: RecordingNotificationLedger,
    url: str | None = _URL,
) -> DispatchResult:
    return dispatch_gate_notification(
        _notification(),
        url,
        ledger,
        transport,
        sleep=lambda _s: None,  # deterministic: no wall-clock in the unit gate
    )


def test_successful_dispatch_records_attempt_and_marks_notified() -> None:
    ledger = RecordingNotificationLedger()
    transport = _ScriptedTransport([200])
    assert _dispatch(transport, ledger) is DispatchResult.SENT
    assert ledger.attempts == [("relrun_001", "feature_manifest_approval", 200, None)]
    assert ("relrun_001", "feature_manifest_approval") in ledger.notified
    # The POST body is the metadata-only Slack message.
    (_url, body) = transport.posts[0]
    assert b"relrun_001" in body
    assert b"pending items: 4" in body


def test_replay_after_delivery_is_a_no_op() -> None:
    # AC3 idempotency: a resumed/replayed graph re-raising the same interrupt re-pings
    # nobody — the ledger short-circuits before any I/O.
    ledger = RecordingNotificationLedger()
    first = _ScriptedTransport([200])
    assert _dispatch(first, ledger) is DispatchResult.SENT
    replay = _ScriptedTransport([200])
    assert _dispatch(replay, ledger) is DispatchResult.SKIPPED
    assert replay.posts == []
    assert len(ledger.attempts) == 1


def test_webhook_500_never_raises_and_records_the_retry_trail() -> None:
    # AC4 failure isolation: a persistent 500 exhausts the bounded retries, records every
    # attempt on the ledger row, and returns FAILED — the caller's interrupt proceeds.
    ledger = RecordingNotificationLedger()
    transport = _ScriptedTransport([500, 500, 500])
    assert _dispatch(transport, ledger) is DispatchResult.FAILED
    assert len(transport.posts) == 3
    assert [a[2] for a in ledger.attempts] == [500, 500, 500]
    assert all(a[3] == "HTTP 500" for a in ledger.attempts)
    assert ledger.notified == set()


def test_transient_failure_then_success_reuses_the_ledger_row() -> None:
    # AC3 redelivery: a transient 503 is retried with backoff and the eventual delivery
    # lands on the same (run, gate) key — attempt count 2, one notified stamp.
    ledger = RecordingNotificationLedger()
    transport = _ScriptedTransport([503, 200])
    assert _dispatch(transport, ledger) is DispatchResult.SENT
    assert [a[2] for a in ledger.attempts] == [503, 200]
    assert ("relrun_001", "feature_manifest_approval") in ledger.notified


def test_permanent_4xx_is_not_retried() -> None:
    # A revoked/invalid webhook (404) can't be fixed by retrying; one attempt, FAILED.
    ledger = RecordingNotificationLedger()
    transport = _ScriptedTransport([404])
    assert _dispatch(transport, ledger) is DispatchResult.FAILED
    assert len(transport.posts) == 1


def test_network_error_is_caught_narrowly_and_retried() -> None:
    # URLError (no HTTP status) is transient: retried, recorded with a secret-free label.
    ledger = RecordingNotificationLedger()
    transport = _ScriptedTransport([urllib.error.URLError("timed out"), 200])
    assert _dispatch(transport, ledger) is DispatchResult.SENT
    assert ledger.attempts[0][2] is None
    assert ledger.attempts[0][3] == "URLError"


def test_unset_webhook_url_is_a_no_op() -> None:
    # AC5: feature fully off when SLACK_WEBHOOK_URL is unset — no I/O, no ledger row.
    ledger = RecordingNotificationLedger()
    transport = _ScriptedTransport([200])
    assert _dispatch(transport, ledger, url=None) is DispatchResult.DISABLED
    assert transport.posts == []
    assert ledger.attempts == []


def test_resolve_webhook_url_boundary() -> None:
    # T4: unset/blank → off; http (would leak the embedded credential) → off; https → on.
    assert resolve_webhook_url(None) is None
    assert resolve_webhook_url("   ") is None
    assert resolve_webhook_url("http://hooks.slack.com/services/T/B/X") is None
    assert resolve_webhook_url(f"  {_URL}  ") == _URL
