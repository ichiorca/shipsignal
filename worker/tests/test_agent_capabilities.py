"""Unit tests for the agent→capability allowlist (migration 0035): ``AuroraAgentCapabilitySource``
(the DB-wins-per-agent merge over the code-default agent map + fail-safe on a DB read error), the
code default itself, and the pure ``gate_artifact_types`` gating the content graph applies.

Uses a tiny psycopg-shaped stub (no DB), mirroring ``test_capability_skills`` — the resolver only
needs ``conn.cursor()`` → ``execute(...)`` / ``fetchall()``."""

from __future__ import annotations

import psycopg

from release_worker.aurora_agent_capabilities import AuroraAgentCapabilitySource
from release_worker.content_nodes import (
    CONTENT_GENERATION_AGENT_ID,
    code_default_agent_capabilities,
    gate_artifact_types,
)

_CODE_DEFAULT: dict[str, frozenset[str]] = {
    "content-generation": frozenset({"release_blog", "changelog_entry", "x_post"}),
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


def test_resolve_db_wins_per_agent_and_unmapped_falls_back() -> None:
    # content-generation overridden in the DB (only release_blog); a second agent absent → its
    # code default would apply (none here, so just the DB set survives for the overridden agent).
    conn = _StubConn(rows=[("content-generation", "release_blog")])
    source = AuroraAgentCapabilitySource(conn, _CODE_DEFAULT)  # type: ignore[arg-type]

    resolved = source.resolve()

    assert resolved["content-generation"] == frozenset(
        {"release_blog"}
    )  # DB authoritative


def test_resolve_unions_multiple_rows_for_an_agent() -> None:
    conn = _StubConn(
        rows=[
            ("content-generation", "release_blog"),
            ("content-generation", "demo_script"),
        ]
    )
    source = AuroraAgentCapabilitySource(conn, _CODE_DEFAULT)  # type: ignore[arg-type]

    resolved = source.resolve()

    assert resolved["content-generation"] == frozenset({"release_blog", "demo_script"})


def test_resolve_falls_back_to_code_default_on_db_error() -> None:
    conn = _StubConn(error=True)
    source = AuroraAgentCapabilitySource(conn, _CODE_DEFAULT)  # type: ignore[arg-type]

    assert source.resolve() == _CODE_DEFAULT


def test_code_default_maps_content_generation_to_every_artifact_type() -> None:
    """The code default (the floor) maps exactly the content-generation agent to a non-empty set of
    artifact types, and includes the canonical initial types."""
    defaults = code_default_agent_capabilities()
    assert set(defaults) == {CONTENT_GENERATION_AGENT_ID}
    types = defaults[CONTENT_GENERATION_AGENT_ID]
    assert {"release_blog", "changelog_entry", "demo_script"} <= types
    assert len(types) >= 6  # at least the PRD §8.1 initial set


def test_gate_drops_disallowed_types_and_preserves_order() -> None:
    selected = ("release_blog", "x_post", "changelog_entry")
    allowed = frozenset({"changelog_entry", "release_blog"})
    assert gate_artifact_types(selected, allowed) == ("release_blog", "changelog_entry")


def test_gate_with_no_allowlist_passes_selection_through() -> None:
    selected = ("release_blog", "x_post")
    assert gate_artifact_types(selected, None) == selected
