"""T3 (spec 020) — the metadata-only guarantee on the gate-notification payload.

Exercises the public surface (``GateNotification`` + the builders): the closed field set
against a denylist of content/PII fields (AC2: constitution §5 — no PII in telemetry), the
§5.6 interrupt-payload builder for all three gates, the run-failure builder, and that the
Slack text is composed from the metadata fields alone.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from release_worker.notification_models import (
    GATE_PENDING_COUNT_FIELDS,
    RUN_FAILED_EVENT,
    GateNotification,
    MalformedInterruptPayloadError,
    build_failure_notification,
    interrupt_payload,
    notification_from_interrupt,
    slack_message_text,
)

# Content/PII field names that must NEVER appear on the notification payload (AC2):
# artifact bodies, claim text, evidence excerpts, reviewer identity, personal data.
_CONTENT_FIELD_DENYLIST = frozenset(
    {
        "body",
        "body_markdown",
        "content",
        "text",
        "title",
        "summary",
        "claim_text",
        "claims",
        "evidence",
        "evidence_excerpt",
        "excerpt",
        "diff",
        "patch",
        "prompt",
        "artifact",
        "artifact_body",
        "reviewer",
        "reviewer_name",
        "author",
        "email",
        "user",
        "username",
        "name",
        "notes",
        "edited_payload",
    }
)


def _gate1_payload() -> dict[str, object]:
    """The PRD §5.6 example payload, as ``build_gate1_payload`` emits it."""
    return {
        "gate": "feature_manifest_approval",
        "release_run_id": "relrun_001",
        "thread_id": "lg_thread_001",
        "features_pending_review": 4,
        "dashboard_url": "https://app.example.com/releases/relrun_001/review",
    }


def test_payload_fields_never_intersect_content_denylist() -> None:
    # The AC2 test: the model's field names against the denylist of content fields.
    assert not set(GateNotification.model_fields) & _CONTENT_FIELD_DENYLIST


def test_payload_is_closed_against_smuggled_content_fields() -> None:
    # extra="forbid": a content field cannot even be constructed onto the payload.
    with pytest.raises(ValidationError):
        GateNotification(
            repo="acme/app",
            release_run_id="relrun_001",
            event="artifact_review",
            pending_count=2,
            dashboard_url="https://app.example.com/releases/relrun_001/artifacts/review",
            artifact_body="LEAKED CONTENT",  # type: ignore[call-arg]
        )


def test_notification_built_from_gate1_interrupt_payload() -> None:
    notification = notification_from_interrupt(_gate1_payload(), "acme/app")
    assert notification.repo == "acme/app"
    assert notification.release_run_id == "relrun_001"
    assert notification.event == "feature_manifest_approval"
    assert notification.pending_count == 4
    assert notification.dashboard_url.endswith("/releases/relrun_001/review")
    assert notification.failure_stage is None


@pytest.mark.parametrize(
    ("gate", "count_field", "url_suffix"),
    [
        ("feature_manifest_approval", "features_pending_review", "/review"),
        ("artifact_review", "artifacts_pending_review", "/artifacts/review"),
        ("skill_candidate_approval", "candidates_pending_review", "/skills/review"),
    ],
)
def test_all_three_gates_map_to_their_pending_count_field(
    gate: str, count_field: str, url_suffix: str
) -> None:
    # AC1: each gate's payload carries its own count field + deep link; the builder
    # recognises all three (the mapping is the single source of truth).
    assert GATE_PENDING_COUNT_FIELDS[gate] == count_field
    payload = {
        "gate": gate,
        "release_run_id": "relrun_002",
        "thread_id": "t",
        count_field: 3,
        "dashboard_url": f"https://app.example.com/releases/relrun_002{url_suffix}",
    }
    notification = notification_from_interrupt(payload, "acme/app")
    assert notification.event == gate
    assert notification.pending_count == 3
    assert notification.dashboard_url.endswith(url_suffix)


def test_unknown_gate_or_missing_fields_fail_closed() -> None:
    with pytest.raises(MalformedInterruptPayloadError):
        notification_from_interrupt({"gate": "not_a_gate"}, "acme/app")
    incomplete = _gate1_payload()
    del incomplete["features_pending_review"]
    with pytest.raises(MalformedInterruptPayloadError):
        notification_from_interrupt(incomplete, "acme/app")


def test_failure_notification_links_run_detail_and_names_stage() -> None:
    notification = build_failure_notification(
        "relrun_003", "acme/app", "content_generation", "https://app.example.com/"
    )
    assert notification.event == RUN_FAILED_EVENT
    assert notification.pending_count == 0
    assert notification.failure_stage == "content_generation"
    # rstrip on the base avoids a double slash from a trailing-slash env value.
    assert notification.dashboard_url == "https://app.example.com/releases/relrun_003"


class _FakeInterrupt:
    """Duck-typed stand-in for langgraph's Interrupt (carries ``.value``)."""

    def __init__(self, value: object) -> None:
        self.value = value


def test_interrupt_payload_extracts_first_interrupt_value() -> None:
    result = {"__interrupt__": (_FakeInterrupt(_gate1_payload()),)}
    payload = interrupt_payload(result)
    assert payload is not None
    assert payload["gate"] == "feature_manifest_approval"


def test_interrupt_payload_returns_none_when_run_completed() -> None:
    assert interrupt_payload({"release_run_id": "relrun_001"}) is None
    assert interrupt_payload({"__interrupt__": ()}) is None
    assert interrupt_payload("not a mapping") is None


def test_slack_text_carries_metadata_only() -> None:
    gate_text = slack_message_text(
        notification_from_interrupt(_gate1_payload(), "acme/app")
    )
    assert "acme/app" in gate_text
    assert "relrun_001" in gate_text
    assert "pending items: 4" in gate_text
    assert "https://app.example.com/releases/relrun_001/review" in gate_text

    failure_text = slack_message_text(
        build_failure_notification(
            "relrun_003", "acme/app", "media_generation", "https://app.example.com"
        )
    )
    assert "failed stage: media_generation" in failure_text
