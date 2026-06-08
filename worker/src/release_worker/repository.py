"""T1 (spec 015) — release-run persistence boundary for the LangGraph worker.

P4 (Storage): the run lifecycle is persisted in Aurora, keyed by ``release_run_id``.
This module defines the *protocol* the node logic depends on plus an in-memory fake;
the real psycopg implementation lives in ``aurora_repository`` (imported only at
runtime) so the unit gate exercises the node against the fake without a DB.

Supersedes the spec-001 skeleton (``mark_running``/``mark_completed``): the worker now
advances a run one step at a time through the full PRD §13.2 lifecycle via ``advance``,
which validates each hop through the shared status lattice and is idempotent under
re-dispatch (advancing to an already-passed progress state is a no-op).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from release_worker.status import (
    RunStatus,
    assert_transition,
    is_redundant_advance,
)


@runtime_checkable
class ReleaseRunRepository(Protocol):
    """The narrow slice of ``release_runs`` access the lifecycle nodes need."""

    def get_status(self, release_run_id: str) -> RunStatus:
        """Return the run's current status. Raises ``KeyError`` if unknown."""
        ...

    def set_thread_id(self, release_run_id: str, thread_id: str) -> None:
        """Persist the run's ``langgraph_thread_id`` (and stamp ``started_at`` once)."""
        ...

    def advance(self, release_run_id: str, target: RunStatus) -> None:
        """Advance the run to ``target``, validating the hop through the lattice.

        Idempotent under re-dispatch: a no-op when the run is already at or past
        ``target`` on the progress path. Raises ``InvalidStatusTransitionError`` on an
        illegal (out-of-order) move.
        """
        ...

    def mark_failed(self, release_run_id: str) -> None:
        """Best-effort terminal-fail used by the entry point's error path."""
        ...


class UnknownReleaseRunError(KeyError):
    """Raised when a repository is asked about a ``release_run_id`` it has no row for."""


class InMemoryReleaseRunRepository:
    """In-process repository for unit tests and local/dev runs.

    Mirrors the durable Aurora behaviour: a run is pre-inserted ``created`` (as the API
    or webhook does), then advanced step-by-step by the worker. ``thread_id`` and the
    visited statuses are recorded so a test can assert the worker wrote them back.
    """

    def __init__(self) -> None:
        self._status: dict[str, RunStatus] = {}
        self.thread_ids: dict[str, str] = {}
        # Ordered record of every status actually written (idempotent no-ops excluded),
        # so a test can assert the lifecycle a run walked through.
        self.transitions: dict[str, list[RunStatus]] = {}
        self.failed_marked: set[str] = set()

    def seed_created(self, release_run_id: str) -> None:
        """Pre-insert a run in ``created`` (stands in for the API/webhook insert)."""
        self._status[release_run_id] = RunStatus.CREATED
        self.transitions.setdefault(release_run_id, [])

    def get_status(self, release_run_id: str) -> RunStatus:
        if release_run_id not in self._status:
            raise UnknownReleaseRunError(release_run_id)
        return self._status[release_run_id]

    def set_thread_id(self, release_run_id: str, thread_id: str) -> None:
        if release_run_id not in self._status:
            raise UnknownReleaseRunError(release_run_id)
        self.thread_ids[release_run_id] = thread_id

    def advance(self, release_run_id: str, target: RunStatus) -> None:
        if release_run_id not in self._status:
            raise UnknownReleaseRunError(release_run_id)
        current = self._status[release_run_id]
        if is_redundant_advance(current, target):
            return  # already at/past this progress state (idempotent re-dispatch)
        assert_transition(current, target)
        self._status[release_run_id] = target
        self.transitions.setdefault(release_run_id, []).append(target)

    def mark_failed(self, release_run_id: str) -> None:
        if release_run_id not in self._status:
            raise UnknownReleaseRunError(release_run_id)
        self._status[release_run_id] = RunStatus.FAILED
        self.failed_marked.add(release_run_id)
        self.transitions.setdefault(release_run_id, []).append(RunStatus.FAILED)
