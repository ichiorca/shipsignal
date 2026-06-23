"""Unit tests for ``AuroraCapabilitySkillSource.resolve`` — the DB-wins-per-type merge over the
code-default capability→skill map, and its fail-safe to the code default on a DB read error.

Uses a tiny psycopg-shaped stub (no DB): the resolver only needs ``conn.cursor()`` →
``execute(...)`` / ``fetchall()``. This mirrors how the runtime adapter is exercised without a live
Aurora — the in-memory ``InMemoryCapabilitySkillSource`` covers the generation path."""

from __future__ import annotations

import psycopg

from release_worker.aurora_capability_skills import AuroraCapabilitySkillSource

_CODE_DEFAULT: dict[str, frozenset[str]] = {
    "release_blog": frozenset({"blog-format", "brand-voice"}),
    "changelog_entry": frozenset({"changelog-format", "brand-voice"}),
}


class _StubCursor:
    def __init__(self, rows: list[tuple[str, str]] | None, error: bool) -> None:
        self._rows = rows
        self._error = error

    def __enter__(self) -> _StubCursor:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None

    def execute(self, _sql: str) -> None:
        if self._error:
            raise psycopg.OperationalError("boom")

    def fetchall(self) -> list[tuple[str, str]]:
        return self._rows or []


class _StubConn:
    def __init__(
        self, rows: list[tuple[str, str]] | None = None, error: bool = False
    ) -> None:
        self._rows = rows
        self._error = error

    def cursor(self) -> _StubCursor:
        return _StubCursor(self._rows, self._error)


def test_resolve_db_wins_per_type_and_unmapped_falls_back() -> None:
    # release_blog overridden in the DB (only brand-voice); changelog_entry absent → code default.
    conn = _StubConn(rows=[("release_blog", "brand-voice")])
    source = AuroraCapabilitySkillSource(conn, _CODE_DEFAULT)  # type: ignore[arg-type]

    resolved = source.resolve()

    assert resolved["release_blog"] == frozenset(
        {"brand-voice"}
    )  # DB set is authoritative
    assert resolved["changelog_entry"] == frozenset({"changelog-format", "brand-voice"})


def test_resolve_unions_multiple_rows_for_a_type() -> None:
    conn = _StubConn(
        rows=[("release_blog", "blog-format"), ("release_blog", "launch-narrative")]
    )
    source = AuroraCapabilitySkillSource(conn, _CODE_DEFAULT)  # type: ignore[arg-type]

    resolved = source.resolve()

    assert resolved["release_blog"] == frozenset({"blog-format", "launch-narrative"})


def test_resolve_falls_back_to_code_default_on_db_error() -> None:
    conn = _StubConn(error=True)
    source = AuroraCapabilitySkillSource(conn, _CODE_DEFAULT)  # type: ignore[arg-type]

    assert source.resolve() == _CODE_DEFAULT
