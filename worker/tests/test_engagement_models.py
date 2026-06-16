"""T1 (spec 021) — the aggregate-only engagement contract (GDPR rails, spec AC).

The load-bearing assertions: ``EngagementTotals`` is a CLOSED, numbers-only model — its
field names never intersect a user-level/PII denylist, a smuggled user-level field raises
``ValidationError`` (so "nothing user-level can be persisted" holds at the model layer,
matching the CHECK-pinned schema of migration 0021), negative counts are rejected, and
``None`` ("not yet reported") stays distinct from a reported 0.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from release_worker.engagement_models import (
    EngagementMetricKind,
    EngagementTotals,
    EngagementTotalsReader,
    StaticEngagementReader,
)

# User-level/PII field names that must NEVER appear on the engagement record: the spec
# ingests aggregate counts only — no user-level events, pixels, cookies, fingerprints.
_USER_LEVEL_FIELD_DENYLIST = frozenset(
    {
        "user",
        "user_id",
        "username",
        "email",
        "ip",
        "ip_address",
        "cookie",
        "session_id",
        "device_id",
        "fingerprint",
        "visitor_id",
        "client_id",
        "referrer",
        "user_agent",
        "location",
        "name",
        "events",
        "event_payload",
    }
)


def test_totals_fields_never_intersect_user_level_denylist() -> None:
    assert not set(EngagementTotals.model_fields) & _USER_LEVEL_FIELD_DENYLIST


def test_totals_are_closed_against_smuggled_user_level_fields() -> None:
    # extra="forbid": a user-level field cannot even be constructed onto the record.
    with pytest.raises(ValidationError):
        EngagementTotals(
            release_run_id="run-1",
            views=10,
            user_id="leaked-user",  # type: ignore[call-arg]
        )


def test_negative_counts_are_rejected() -> None:
    # An aggregate count can never be below zero (matches the CHECK in migration 0021).
    with pytest.raises(ValidationError):
        EngagementTotals(release_run_id="run-1", clicks=-1)


def test_unreported_defaults_to_none_distinct_from_zero() -> None:
    totals = EngagementTotals(release_run_id="run-1", clicks=0)
    assert totals.views is None  # never reported
    assert totals.clicks == 0  # reported zero is a real measurement
    assert totals.views != totals.clicks


def test_vocabularies_match_migration_check_constraints() -> None:
    # The closed metric vocabulary every layer (migration 0021 CHECK, TS schema) agrees on.
    # The `source` vocabulary is validated TS-side (app/lib/engagement.ts) where ingestion
    # actually happens; the Python worker only reads aggregate totals, so it carries no source enum.
    assert {k.value for k in EngagementMetricKind} == {"views", "clicks", "conversions"}


def test_static_reader_satisfies_the_reader_port() -> None:
    fixed = EngagementTotals(release_run_id="run-1", views=5)
    reader = StaticEngagementReader(fixed)
    assert isinstance(reader, EngagementTotalsReader)
    assert reader.totals() is fixed
