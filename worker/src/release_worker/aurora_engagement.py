"""T1 (spec 021) — runtime Aurora adapter for aggregate engagement totals.

P4 (Storage) + aurora-postgresql-rules: the eval step depends only on the narrow
``EngagementTotalsReader`` Protocol (``engagement_models``); this psycopg implementation
is the durable side over ``engagement_metrics`` (migration 0021), imported only by
``__main__`` (the runtime entry point) so the unit gate never needs a DB. Every statement
is parameterised and scoped by ``release_run_id`` (constitution §2 — no cross-run bleed).

Read semantics: a row is a cumulative snapshot "as of" a date, so the current truth per
(artifact, metric) is the FRESHEST row (latest ``as_of``, then latest ``created_at`` to
break a same-day tie across sources) — summing every daily snapshot would double-count.
The run total per metric sums that freshest value across the run's artifacts. A metric
with no rows at all stays ``None`` ("not yet reported", never zero — spec AC). The TS
read side (``app/lib/db/engagementMetrics.ts``) applies the same DISTINCT ON shape so the
dashboard and the eval rows can never disagree.

§5: only aggregate counts move through here — the table cannot hold user-level data by
construction (CHECK-pinned vocabularies + numeric value), and nothing is logged.
"""

from __future__ import annotations

import psycopg

from release_worker.engagement_models import EngagementMetricKind, EngagementTotals


class AuroraEngagementReader:
    """``EngagementTotalsReader`` over the Aurora ``engagement_metrics`` table."""

    def __init__(self, conn: psycopg.Connection, release_run_id: str) -> None:
        self._conn = conn
        self._release_run_id = release_run_id

    def totals(self) -> EngagementTotals:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT latest.metric, SUM(latest.value)::bigint
                  FROM (
                        SELECT DISTINCT ON (artifact_id, metric)
                               metric, value
                          FROM engagement_metrics
                         WHERE release_run_id = %s
                         ORDER BY artifact_id, metric, as_of DESC, created_at DESC
                       ) AS latest
                 GROUP BY latest.metric
                """,
                (self._release_run_id,),
            )
            rows = cur.fetchall()
        by_metric: dict[str, int] = {metric: int(total) for metric, total in rows}
        return EngagementTotals(
            release_run_id=self._release_run_id,
            views=by_metric.get(EngagementMetricKind.VIEWS.value),
            clicks=by_metric.get(EngagementMetricKind.CLICKS.value),
            conversions=by_metric.get(EngagementMetricKind.CONVERSIONS.value),
        )
