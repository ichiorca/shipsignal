"""T1 (spec 021) — aggregate engagement totals: the closed vocabularies + the reader port.

PRD §17.1 (this spec extends the product-quality table with outcome metrics): once
exported artifacts are in the wild with UTM-stamped links, the dashboard ingests
AGGREGATE engagement counts per artifact (views / clicks / conversions) — and the eval
step folds the run-level totals into ``eval_runs`` next to the quality metrics.

GDPR rails (load-bearing for this spec): ``EngagementTotals`` is frozen +
``extra="forbid"`` with a closed, numbers-only field set — there is no field that could
hold a user id, IP, cookie, email, or event payload, and a smuggled one raises
``ValidationError``. ``None`` means "not yet reported", which the consumers must keep
distinct from zero (the spec AC: missing engagement is never rendered as 0).

The runtime ``aurora_engagement.AuroraEngagementReader`` satisfies the Protocol;
``StaticEngagementReader`` is the unit-gate fake (mirrors ``RecordingEvalSink`` /
``RecordingNotificationLedger``).
"""

from __future__ import annotations

from enum import StrEnum
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

# Frozen + extra="forbid": totals are an immutable measurement, and forbidding unknown
# fields keeps any user-level key from ever being smuggled onto the record (§5 / GDPR).
_StrictModel = ConfigDict(frozen=True, extra="forbid")


class EngagementMetricKind(StrEnum):
    """The closed metric vocabulary — matches the ``engagement_metrics.metric`` CHECK
    constraint (migration 0021) and the TS ingestion schema, so every layer agrees."""

    VIEWS = "views"
    CLICKS = "clicks"
    CONVERSIONS = "conversions"


class EngagementTotals(BaseModel):
    """Run-level aggregate engagement (PRD §17.1 outcome extension), scoped by
    ``release_run_id`` (§2). Each total is the SUM over the run's artifacts of the
    freshest reported value per (artifact, metric). ``None`` = that metric was never
    reported for this run — distinct from a reported 0 (spec AC)."""

    model_config = _StrictModel

    release_run_id: str = Field(min_length=1)
    views: int | None = Field(default=None, ge=0)
    clicks: int | None = Field(default=None, ge=0)
    conversions: int | None = Field(default=None, ge=0)


@runtime_checkable
class EngagementTotalsReader(Protocol):
    """Surface one run's aggregate engagement totals for the eval step.
    ``AuroraEngagementReader`` satisfies it at runtime."""

    def totals(self) -> EngagementTotals: ...


class StaticEngagementReader:
    """In-memory ``EngagementTotalsReader`` fake returning a fixed value, so the unit
    gate exercises the eval merge without a DB."""

    def __init__(self, fixed: EngagementTotals) -> None:
        self._fixed = fixed

    def totals(self) -> EngagementTotals:
        return self._fixed
