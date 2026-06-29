"""Unit tests for the runtime Aurora privacy adapters (no live DB).

Uses a tiny psycopg-shaped stub: ``AuroraS3ErasureStore.delete_run_rows`` opens
``conn.transaction()`` + ``conn.cursor()``, and ``count_run_rows`` opens ``conn.cursor()``
and reads ``fetchone()``. The stub records whether each statement ran inside an open
transaction so the test can prove the two DELETEs are atomic (autocommit-safe). ``_coerce_flags``
is exercised directly for the GDPR Art.15 export path (malformed jsonb must not raise).
"""

from __future__ import annotations

from release_worker.aurora_privacy import AuroraS3ErasureStore, _coerce_flags


class _StubCursor:
    def __init__(self, conn: _StubConn) -> None:
        self._conn = conn
        self.rowcount = 0

    def __enter__(self) -> _StubCursor:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None

    def execute(self, sql: str, params: object = None) -> None:
        self._conn.executed.append((sql, params, self._conn.in_transaction))
        self.rowcount = self._conn.next_rowcount

    def fetchone(self) -> tuple[object, ...] | None:
        return self._conn.next_fetchone


class _StubTransaction:
    def __init__(self, conn: _StubConn) -> None:
        self._conn = conn

    def __enter__(self) -> _StubTransaction:
        self._conn.in_transaction = True
        self._conn.transactions_opened += 1
        return self

    def __exit__(self, *_exc: object) -> None:
        self._conn.in_transaction = False


class _StubConn:
    def __init__(self) -> None:
        self.executed: list[tuple[str, object, bool]] = []
        self.in_transaction = False
        self.transactions_opened = 0
        self.next_rowcount = 0
        self.next_fetchone: tuple[object, ...] | None = None

    def transaction(self) -> _StubTransaction:
        return _StubTransaction(self)

    def cursor(self) -> _StubCursor:
        return _StubCursor(self)


def _store(conn: _StubConn) -> AuroraS3ErasureStore:
    return AuroraS3ErasureStore(
        conn,  # type: ignore[arg-type]
        object(),
        evidence_bucket="evidence-bkt",
        media_bucket="media-bkt",
    )


def test_delete_run_rows_runs_both_deletes_in_one_transaction() -> None:
    conn = _StubConn()
    conn.next_rowcount = 1
    store = _store(conn)

    deleted = store.delete_run_rows("11111111-1111-4111-8111-111111111111")

    # Exactly one transaction wraps the unit (all-or-nothing on the autocommit connection).
    assert conn.transactions_opened == 1
    # Both statements (approvals delete, then release_runs delete) ran inside it.
    assert len(conn.executed) == 2
    assert all(in_txn for _sql, _params, in_txn in conn.executed)
    assert "DELETE FROM approvals" in conn.executed[0][0]
    assert "DELETE FROM release_runs" in conn.executed[1][0]
    assert deleted == 1


def test_count_run_rows_returns_the_summed_count() -> None:
    conn = _StubConn()
    conn.next_fetchone = (3,)
    store = _store(conn)

    assert store.count_run_rows("11111111-1111-4111-8111-111111111111") == 3


def test_count_run_rows_treats_no_row_as_zero() -> None:
    conn = _StubConn()
    conn.next_fetchone = None
    store = _store(conn)

    assert store.count_run_rows("11111111-1111-4111-8111-111111111111") == 0


def test_coerce_flags_parses_a_valid_json_string() -> None:
    assert _coerce_flags('["pii", "secret"]') == ["pii", "secret"]


def test_coerce_flags_passes_through_a_list() -> None:
    assert _coerce_flags(["pii", 7]) == ["pii", "7"]


def test_coerce_flags_returns_empty_for_none() -> None:
    assert _coerce_flags(None) == []


def test_coerce_flags_falls_back_on_malformed_json() -> None:
    # A malformed jsonb text value must not crash the Art.15 access export.
    assert _coerce_flags("{not json") == []


def test_coerce_flags_falls_back_when_json_is_not_a_list() -> None:
    # Valid JSON that is not an array (e.g. a bare object/number) also falls back safely.
    assert _coerce_flags('{"a": 1}') == []
    assert _coerce_flags("42") == []
