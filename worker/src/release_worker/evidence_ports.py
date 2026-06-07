"""T2/T4 (spec 002) — ports the evidence nodes depend on, plus in-memory fakes.

P4 (Storage): the nodes never import psycopg/boto3/urllib directly; they depend on
these narrow Protocols. The durable implementations (GitHub diff source, S3+Aurora
sink, Aurora boundary reader) live in runtime-only modules imported by ``__main__``,
so the unit gate exercises the node logic against the fakes here without a DB, an S3
bucket, or network (mirrors spec 001's repository/InMemory split).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from release_worker.evidence_models import EvidenceRecord, ReleaseBoundary


@runtime_checkable
class BoundaryReader(Protocol):
    """Resolve a run's compare range from durable storage (PRD §5.2)."""

    def get_boundary(self, release_run_id: str) -> ReleaseBoundary:
        """Return the run's ``ReleaseBoundary``. Raises ``KeyError`` if unknown."""
        ...


@runtime_checkable
class DiffSource(Protocol):
    """Fetch the raw git diff for a boundary. Returns an *untrusted* payload (typically
    a dict) that the collect node validates through ``RawDiffPayload`` (AC4)."""

    def fetch_raw_diff(self, boundary: ReleaseBoundary) -> object: ...


@runtime_checkable
class EvidenceSink(Protocol):
    """Persist redacted evidence: the full redacted excerpt to S3 (blob), the row to
    Aurora. Both are downstream of the redact node (constitution §5)."""

    def store_blob(
        self, release_run_id: str, evidence_id: str, redacted_text: str
    ) -> str:
        """Upload the redacted full excerpt; return its ``s3://`` URI."""
        ...

    def record(self, item: EvidenceRecord) -> None:
        """Insert one redacted evidence_items row."""
        ...


class UnknownBoundaryError(KeyError):
    """Raised when a ``BoundaryReader`` has no boundary for a ``release_run_id``."""


class InMemoryBoundaryReader:
    """In-process ``BoundaryReader`` for unit/dev runs."""

    def __init__(self) -> None:
        self._boundaries: dict[str, ReleaseBoundary] = {}

    def seed(self, boundary: ReleaseBoundary) -> None:
        self._boundaries[boundary.release_run_id] = boundary

    def get_boundary(self, release_run_id: str) -> ReleaseBoundary:
        if release_run_id not in self._boundaries:
            raise UnknownBoundaryError(release_run_id)
        return self._boundaries[release_run_id]


class StaticDiffSource:
    """A ``DiffSource`` that returns a fixed payload — for tests and local dev.

    Hand it a well-formed dict to exercise the happy path, or a malformed one to prove
    the collect node fails closed (AC4).
    """

    def __init__(self, payload: object) -> None:
        self._payload = payload

    def fetch_raw_diff(self, boundary: ReleaseBoundary) -> object:
        return self._payload


class InMemoryEvidenceSink:
    """In-process ``EvidenceSink``: records blobs and rows so tests can assert that
    only redacted content was ever persisted (the redact-before-persist proof)."""

    def __init__(self, bucket: str = "test-evidence") -> None:
        self._bucket = bucket
        self.blobs: dict[str, str] = {}
        self.records: list[EvidenceRecord] = []

    def store_blob(
        self, release_run_id: str, evidence_id: str, redacted_text: str
    ) -> str:
        key = f"evidence/{release_run_id}/{evidence_id}.txt"
        self.blobs[key] = redacted_text
        return f"s3://{self._bucket}/{key}"

    def record(self, item: EvidenceRecord) -> None:
        self.records.append(item)
