"""Integration (spec 023): the durable LLM response cache against a REAL TLS Postgres.

Proves what the in-memory fake cannot:
  * ``put`` round-trips through JSONB and ``get`` reads it back as a dict;
  * cross-process dedup — a SECOND adapter instance on a fresh connection (the resume job)
    sees the first job's stored response;
  * cross-run isolation (constitution §2) — the same idempotency_key under a different
    release_run_id does NOT resolve;
  * first-writer-wins on the composite PK;
  * ``delete_older_than`` is the age-based size sweep, and the FK CASCADE clears cache rows
    when their run is deleted (the GDPR-erasure path).
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta

import pytest

from release_worker.aurora_llm_cache import AuroraLlmResponseCache
from release_worker.aurora_repository import connect_from_env


def _new_run(cur, repo: str = "octo/demo") -> str:
    cur.execute(
        """
        INSERT INTO release_runs (repo, base_ref, head_ref, trigger_type)
        VALUES (%s, 'v1.0.0', 'v1.1.0', 'manual')
        RETURNING id
        """,
        (repo,),
    )
    return str(cur.fetchone()[0])


def test_durable_cache_round_trip_and_run_isolation() -> None:
    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set (bring up the local stack first)")

    conn = connect_from_env()
    run_a: str | None = None
    run_b: str | None = None
    try:
        with conn.cursor() as cur:
            run_a = _new_run(cur)
            run_b = _new_run(cur)

        cache = AuroraLlmResponseCache(conn)

        # Miss, then store, then hit (JSONB round-trips back to a dict).
        assert cache.get(run_a, "k1") is None
        stored = cache.put(
            run_a,
            "k1",
            task_name="cluster_features",
            model_id="anthropic.claude-3-5-sonnet-20241022-v2:0",
            response={"feature": "x", "n": 1},
            input_tokens=11,
            output_tokens=22,
        )
        assert stored == {"feature": "x", "n": 1}
        assert cache.get(run_a, "k1") == {"feature": "x", "n": 1}

        # Cross-process: a fresh adapter on a fresh connection (the resume job) sees it.
        other_conn = connect_from_env()
        try:
            assert AuroraLlmResponseCache(other_conn).get(run_a, "k1") == {
                "feature": "x",
                "n": 1,
            }
        finally:
            other_conn.close()

        # First-writer-wins on the composite PK: a second put with the same key keeps the first.
        again = cache.put(
            run_a,
            "k1",
            task_name="cluster_features",
            model_id="m",
            response={"feature": "OVERWRITE"},
            input_tokens=0,
            output_tokens=0,
        )
        assert again == {"feature": "x", "n": 1}

        # constitution §2: the same key under a different run does not resolve.
        assert cache.get(run_b, "k1") is None
    finally:
        # CASCADE deletes the cache rows with their runs — this also exercises GDPR erasure.
        with conn.cursor() as cur:
            for run in (run_a, run_b):
                if run is not None:
                    cur.execute("DELETE FROM release_runs WHERE id = %s", (run,))
        conn.close()


def test_delete_older_than_sweeps_by_age() -> None:
    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set (bring up the local stack first)")

    conn = connect_from_env()
    run_id: str | None = None
    try:
        with conn.cursor() as cur:
            run_id = _new_run(cur)
        cache = AuroraLlmResponseCache(conn)
        cache.put(
            run_id,
            "k1",
            task_name="cluster_features",
            model_id="m",
            response={"feature": "x"},
            input_tokens=0,
            output_tokens=0,
        )

        # A cutoff in the past keeps the just-written row...
        kept = cache.delete_older_than(datetime.now(UTC) - timedelta(days=1))
        assert kept == 0
        assert cache.get(run_id, "k1") == {"feature": "x"}

        # ...a cutoff in the future sweeps it.
        deleted = cache.delete_older_than(datetime.now(UTC) + timedelta(days=1))
        assert deleted == 1
        assert cache.get(run_id, "k1") is None
    finally:
        with conn.cursor() as cur:
            if run_id is not None:
                cur.execute("DELETE FROM release_runs WHERE id = %s", (run_id,))
        conn.close()
