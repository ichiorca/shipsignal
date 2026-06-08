"""T3 (spec 011) — runtime Aurora adapter for model-call cost/latency telemetry.

P4 (Storage) + aurora-postgresql-rules: the pure metering logic (``cost_telemetry.meter_call``)
depends only on the narrow ``CostTelemetrySink`` Protocol; this psycopg implementation is the
durable side, imported only by ``__main__`` (the runtime entry point) so the unit gate never
needs a DB. The single INSERT is parameterized and scoped by ``release_run_id`` (constitution
§2). The row carries metrics + provenance only — never a prompt, evidence, or model output
(constitution §5), matching the ``model_call_telemetry`` schema (migration 0011).
"""

from __future__ import annotations

import psycopg

from release_worker.cost_telemetry import ModelCallTelemetry


class AuroraCostTelemetrySink:
    """``CostTelemetrySink`` over the Aurora ``model_call_telemetry`` table (migration 0011)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def record(self, telemetry: ModelCallTelemetry) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO model_call_telemetry (
                    release_run_id, node_name, model_id, model_tier,
                    input_tokens, output_tokens, latency_ms, cost_usd_estimate
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    telemetry.release_run_id,
                    telemetry.node,
                    telemetry.model_id,
                    telemetry.model_tier,
                    telemetry.input_tokens,
                    telemetry.output_tokens,
                    telemetry.latency_ms,
                    telemetry.cost_usd_estimate,
                ),
            )
