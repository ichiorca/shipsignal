"""T5 (spec 001) — release-run persistence boundary for the LangGraph worker.

P4 (Storage): the run lifecycle is persisted in Aurora, keyed by ``release_run_id``.
This module defines the *protocol* the node logic depends on plus an in-memory fake;
the real psycopg implementation lives in ``aurora_repository`` (imported only at
runtime) so the unit gate exercises the node against the fake without a DB.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from release_worker.status import RunStatus


@runtime_checkable
class ReleaseRunRepository(Protocol):
    """The narrow slice of ``release_runs`` access the pass-through node needs."""

    def get_status(self, release_run_id: str) -> RunStatus:
        """Return the run's current status. Raises ``KeyError`` if unknown."""
        ...

    def mark_running(self, release_run_id: str, thread_id: str) -> None:
        """Move the run to ``running`` and persist its ``langgraph_thread_id``."""
        ...

    def mark_completed(self, release_run_id: str) -> None:
        """Move the run to its terminal ``completed`` status."""
        ...


class UnknownReleaseRunError(KeyError):
    """Raised when a repository is asked about a ``release_run_id`` it has no row for."""


class InMemoryReleaseRunRepository:
    """In-process repository for unit tests and local/dev runs.

    Mirrors the durable Aurora behaviour: a run is pre-inserted ``queued`` (as the API
    or webhook does), then advanced by the worker. ``thread_id`` and the timestamps
    are recorded so a test can assert the worker wrote them back.
    """

    def __init__(self) -> None:
        self._status: dict[str, RunStatus] = {}
        self.thread_ids: dict[str, str] = {}
        self.running_marked: set[str] = set()
        self.completed_marked: set[str] = set()

    def seed_queued(self, release_run_id: str) -> None:
        """Pre-insert a run in ``queued`` (stands in for the API/webhook insert)."""
        self._status[release_run_id] = RunStatus.QUEUED

    def get_status(self, release_run_id: str) -> RunStatus:
        if release_run_id not in self._status:
            raise UnknownReleaseRunError(release_run_id)
        return self._status[release_run_id]

    def mark_running(self, release_run_id: str, thread_id: str) -> None:
        if release_run_id not in self._status:
            raise UnknownReleaseRunError(release_run_id)
        self._status[release_run_id] = RunStatus.RUNNING
        self.thread_ids[release_run_id] = thread_id
        self.running_marked.add(release_run_id)

    def mark_completed(self, release_run_id: str) -> None:
        if release_run_id not in self._status:
            raise UnknownReleaseRunError(release_run_id)
        self._status[release_run_id] = RunStatus.COMPLETED
        self.completed_marked.add(release_run_id)
