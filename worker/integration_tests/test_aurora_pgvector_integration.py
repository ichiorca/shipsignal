"""Integration: the worker's Aurora seam against a REAL TLS Postgres + pgvector.

Proves three things the in-memory fakes never can:
  * ``connect_from_env`` actually negotiates TLS (constitution: TLS is mandatory);
  * the pgvector extension is installed (i.e. the Alembic migrations really applied);
  * a cosine-distance (``<=>``) nearest-neighbour query returns the right row — the
    real retrieval path PRD §11 depends on.
"""

from __future__ import annotations

import os

import pytest

from release_worker.aurora_repository import connect_from_env


def test_tls_active_and_pgvector_search() -> None:
    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set (bring up the local stack first)")

    conn = connect_from_env()
    try:
        with conn.cursor() as cur:
            # TLS was truly negotiated for THIS backend connection.
            cur.execute("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()")
            ssl_row = cur.fetchone()
            assert ssl_row is not None
            assert ssl_row[0] is True

            # pgvector is present -> the migrations ran against this database.
            cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
            assert cur.fetchone() is not None

            # Real vector round-trip + nearest-neighbour by cosine distance.
            cur.execute("CREATE TEMP TABLE _it_vectors (id int, emb vector(3))")
            cur.executemany(
                "INSERT INTO _it_vectors (id, emb) VALUES (%s, %s::vector)",
                [(1, "[1,0,0]"), (2, "[0,1,0]"), (3, "[0.92,0.08,0]")],
            )
            cur.execute(
                "SELECT id FROM _it_vectors ORDER BY emb <=> %s::vector LIMIT 1",
                ("[1,0,0]",),
            )
            nearest = cur.fetchone()
            assert nearest is not None
            assert nearest[0] == 1
    finally:
        conn.close()
