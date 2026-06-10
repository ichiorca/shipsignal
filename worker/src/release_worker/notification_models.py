"""T1/T3 (spec 020) — the metadata-only gate-notification payload and its builders.

When a gate interrupt fires (Gate #1 feature manifest, Gate #2 artifacts, Gate #3 skill
candidate) or a run fails, the worker tells a human via Slack — but the message may carry
counts and identifiers ONLY (constitution §5: no PII in telemetry; nothing
redaction-sensitive leaves the system). This module owns that guarantee at the type level:

* ``GateNotification`` is a CLOSED field set (frozen + extra="forbid"): repo, run id, event
  name, pending count, dashboard deep link, optional failure stage. There is no field an
  artifact body, claim text, evidence excerpt, or reviewer name could ride in on, and the
  unit gate asserts the field names against a content denylist
  (``worker/tests/test_notification_models.py``).
* ``notification_from_interrupt`` builds it from the §5.6 interrupt payload the graphs
  already surface (gate name + pending count + dashboard_url) — the notifier never sees
  graph state, only the already-metadata-only gate payload.
* ``slack_message_text`` renders the Slack text from those fields alone.

The ledger Protocol + in-memory fake live here too (mirroring ``eval_models``) so the pure
dispatch logic in ``notifier`` is unit-tested without psycopg; the durable side is
``aurora_notifications.AuroraGateNotificationLedger``.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

# Frozen + extra="forbid": a notification is an immutable, metadata-only message; forbidding
# unknown fields keeps a content/PII key from ever being smuggled onto it (§5 / AC2).
_StrictModel = ConfigDict(frozen=True, extra="forbid")

# The §5.6 gate names as the graphs emit them, mapped to the per-gate pending-count field in
# the interrupt payload. The notifier recognises exactly these events (fail closed on others).
GATE_PENDING_COUNT_FIELDS: dict[str, str] = {
    "feature_manifest_approval": "features_pending_review",
    "artifact_review": "artifacts_pending_review",
    "skill_candidate_approval": "candidates_pending_review",
}

# The non-gate event: a run transitioned to ``failed`` (AC1).
RUN_FAILED_EVENT = "run_failed"


class GateNotification(BaseModel):
    """One metadata-only reviewer notification (spec 020 AC1/AC2).

    The CLOSED field set is the §5 guarantee: counts and identifiers only — never an
    artifact body, claim text, evidence excerpt, reviewer name, or any personal data.
    """

    model_config = _StrictModel

    repo: str = Field(min_length=1)
    release_run_id: str = Field(min_length=1)
    # A §5.6 gate name (``GATE_PENDING_COUNT_FIELDS``) or ``RUN_FAILED_EVENT``.
    event: str = Field(min_length=1)
    pending_count: int = Field(ge=0)
    dashboard_url: str = Field(min_length=1)
    # Set only for run_failed: which loop phase broke (a machine label, never a message).
    failure_stage: str | None = None


class MalformedInterruptPayloadError(ValueError):
    """Raised when an interrupt payload lacks the expected §5.6 metadata shape.

    User-safe: never echoes the payload (defence in depth — it should already be
    metadata-only), only that it was rejected.
    """

    def __init__(self) -> None:
        super().__init__("the gate interrupt payload was malformed and was rejected")


def interrupt_payload(result: object) -> Mapping[str, object] | None:
    """Extract the first interrupt's payload mapping from a ``graph.invoke`` result.

    LangGraph surfaces a pending interrupt as ``result["__interrupt__"]`` — a sequence of
    ``Interrupt`` objects whose ``.value`` is the dict the gate node passed to
    ``interrupt(...)``. Duck-typed (no langgraph import) so the unit gate exercises it.
    Returns ``None`` when the result holds no interrupt (run completed).
    """
    if not isinstance(result, Mapping):
        return None
    interrupts = result.get("__interrupt__")
    if not isinstance(interrupts, (list, tuple)) or not interrupts:
        return None
    value = getattr(interrupts[0], "value", None)
    return value if isinstance(value, Mapping) else None


def notification_from_interrupt(
    payload: Mapping[str, object], repo: str
) -> GateNotification:
    """Build the notification from a §5.6 gate-interrupt payload (T2).

    The payload already carries everything but the repo: the gate name, the per-gate
    pending count, and the dashboard deep link (PRD §5.6). Validated at this boundary —
    an unknown gate or missing field raises rather than sending a malformed ping.
    """
    gate = payload.get("gate")
    if not isinstance(gate, str) or gate not in GATE_PENDING_COUNT_FIELDS:
        raise MalformedInterruptPayloadError()
    pending = payload.get(GATE_PENDING_COUNT_FIELDS[gate])
    dashboard_url = payload.get("dashboard_url")
    release_run_id = payload.get("release_run_id")
    if (
        not isinstance(pending, int)
        or not isinstance(dashboard_url, str)
        or not isinstance(release_run_id, str)
    ):
        raise MalformedInterruptPayloadError()
    return GateNotification(
        repo=repo,
        release_run_id=release_run_id,
        event=gate,
        pending_count=pending,
        dashboard_url=dashboard_url,
    )


def build_failure_notification(
    release_run_id: str, repo: str, failure_stage: str, dashboard_base_url: str
) -> GateNotification:
    """Build the run-failure notification (AC1: "when a run transitions to ``failed``").

    The deep link is the run-detail page — there is no review queue for a failure, the
    operator just needs to look at the run.
    """
    base = dashboard_base_url.rstrip("/")
    return GateNotification(
        repo=repo,
        release_run_id=release_run_id,
        event=RUN_FAILED_EVENT,
        pending_count=0,
        dashboard_url=f"{base}/releases/{release_run_id}",
        failure_stage=failure_stage,
    )


# Human-readable headline per event, composed ONLY from the closed field set.
_EVENT_HEADLINES: dict[str, str] = {
    "feature_manifest_approval": "Gate #1 open — feature manifest awaiting review",
    "artifact_review": "Gate #2 open — generated artifacts awaiting review",
    "skill_candidate_approval": "Gate #3 open — skill candidate awaiting review",
    RUN_FAILED_EVENT: "Release run failed",
}


def slack_message_text(notification: GateNotification) -> str:
    """Render the Slack message text from the notification's metadata fields alone (§5)."""
    headline = _EVENT_HEADLINES.get(notification.event, notification.event)
    lines = [
        headline,
        f"repo: {notification.repo}",
        f"release_run_id: {notification.release_run_id}",
    ]
    if notification.event == RUN_FAILED_EVENT:
        lines.append(f"failed stage: {notification.failure_stage or 'unknown'}")
    else:
        lines.append(f"pending items: {notification.pending_count}")
    lines.append(f"review: {notification.dashboard_url}")
    return "\n".join(lines)


@runtime_checkable
class GateNotificationLedger(Protocol):
    """Idempotency + audit ledger over ``gate_notifications`` (migration 0020).

    The runtime ``AuroraGateNotificationLedger`` satisfies it; ``RecordingNotificationLedger``
    is the unit-gate fake. Keyed by (release_run_id, gate) — AC3.
    """

    def already_notified(self, release_run_id: str, gate: str) -> bool:
        """True iff a notification for (run, gate) was already DELIVERED."""
        ...

    def record_attempt(
        self, release_run_id: str, gate: str, status: int | None, error: str | None
    ) -> None:
        """Upsert the (run, gate) row: bump attempt_count, record the last outcome."""
        ...

    def mark_notified(self, release_run_id: str, gate: str) -> None:
        """Stamp ``notified_at`` for (run, gate) — the delivery moment (T5 anchor)."""
        ...


class RecordingNotificationLedger:
    """In-memory ``GateNotificationLedger`` fake for the unit gate.

    Tests inspect ``attempts``/``notified`` to assert idempotency on replay, the retry
    trail after a transient failure, and that delivery stamps exactly one notified_at.
    """

    def __init__(self) -> None:
        self.attempts: list[tuple[str, str, int | None, str | None]] = []
        self.notified: set[tuple[str, str]] = set()

    def already_notified(self, release_run_id: str, gate: str) -> bool:
        return (release_run_id, gate) in self.notified

    def record_attempt(
        self, release_run_id: str, gate: str, status: int | None, error: str | None
    ) -> None:
        self.attempts.append((release_run_id, gate, status, error))

    def mark_notified(self, release_run_id: str, gate: str) -> None:
        self.notified.add((release_run_id, gate))
