"""T2 (spec 010) — data-subject erasure across Aurora + S3 (GDPR Art.17).

P5 (Safety rails) / constitution §5: an erasure request removes a subject's personal data
from BOTH stores — Aurora rows and the S3 objects they reference — leaving no
presigned-reachable remnant. Tenancy is the ``release_run_id`` (constitution §2: every row
is run-scoped), so erasing a run is the unit of data-subject erasure: deleting the
``release_runs`` row CASCADEs to evidence/features/claims/artifacts/media/learning_signals
(the FK chain from migrations 0003-0008), and the run's S3 prefixes (``evidence/<run>/`` and
``media/<run>/``) are swept explicitly because S3 has no foreign keys.

The operation is **audited** (a row in ``erasure_audit``, migration 0010) and **verified**:
after deletion it re-lists the S3 prefixes and fails closed if any object remains
(AC: "no objects, no presigned-reachable remnants"). A data-subject-rights request is an
escalation trigger (constitution §7), so the caller must supply who requested it and why —
this is never a silent operation.

Pure stdlib + pydantic (no psycopg/boto3) so the unit gate exercises the flow against an
in-memory fake; the Aurora+S3-backed ``ErasureStore`` lives in the runtime-only
``aurora_privacy`` module, reachable via ``python -m release_worker.privacy erase``.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

_StrictModel = ConfigDict(frozen=True, extra="forbid")

# release_run_id is a UUID we mint — never attacker-controlled — but we validate before
# composing an S3 prefix so a caller can't smuggle a path-traversal segment
# (s3-rules: sanitize object keys built from release input). Mirrors the evidence sink guard.
_SAFE_RUN_ID = re.compile(r"\A[0-9a-fA-F-]{8,36}\Z")


class InvalidReleaseRunIdError(ValueError):
    """Raised when a release_run_id is not a safe S3-key segment (fails closed)."""


class OrphanedObjectsError(RuntimeError):
    """Raised when post-erasure verification still finds S3 objects under the run prefix.

    The erasure is incomplete (Art.17 not satisfied); the operator must investigate rather
    than record a false 'erased' result.
    """


class OrphanedRowsError(RuntimeError):
    """Raised when post-erasure verification still finds run-scoped rows in Aurora.

    The Aurora counterpart of ``OrphanedObjectsError``: deleting the ``release_runs`` row
    should CASCADE-clear every run-scoped table (and the run's ``approvals`` are deleted
    explicitly), so any surviving row means the erasure is incomplete (Art.17 not satisfied)
    and the operator must investigate rather than record a false 'erased' result.
    """


class ErasureReport(BaseModel):
    """The audited outcome of one data-subject erasure (returned and persisted)."""

    model_config = _StrictModel

    release_run_id: str = Field(min_length=1)
    requested_by: str = Field(min_length=1)
    reason: str = Field(min_length=1)
    rows_deleted: int = Field(ge=0)
    objects_deleted: int = Field(ge=0)
    s3_prefixes: tuple[str, ...]
    erased_at: datetime


def _run_prefixes(release_run_id: str) -> tuple[str, ...]:
    """The S3 key prefixes that hold a run's PII-bearing blobs.

    ``evidence/<run>/`` (redacted excerpts, spec 002) and ``media/<run>/`` (rendered demo
    media, spec 008) — the two prefixes the worker writes under a run.
    """
    return (f"evidence/{release_run_id}/", f"media/{release_run_id}/")


@runtime_checkable
class ErasureStore(Protocol):
    """Durable store the erasure depends on (Aurora rows + S3 objects + the audit row).

    The runtime implementation (``aurora_privacy.AuroraS3ErasureStore``) deletes the
    ``release_runs`` row (CASCADE), lists/deletes the S3 prefixes, and inserts the audit
    row; the in-memory fake mirrors that for the unit gate.
    """

    def delete_run_rows(self, release_run_id: str) -> int:
        """Delete the ``release_runs`` row; CASCADE drops all run-scoped child rows.

        Returns the number of rows deleted (0 if the run was already erased — idempotent).
        """
        ...

    def count_run_rows(self, release_run_id: str) -> int:
        """Count run-scoped rows still in Aurora (for post-erasure verification).

        Sums the ``release_runs`` row, every table that CASCADEs from it, and the run's
        ``approvals`` rows; ``0`` proves the run was fully erased.
        """
        ...

    def list_objects(self, prefix: str) -> tuple[str, ...]:
        """Return every S3 object key under ``prefix`` (for delete + verify)."""
        ...

    def delete_objects(self, keys: tuple[str, ...]) -> int:
        """Delete the given S3 object keys; return how many were removed."""
        ...

    def record_audit(self, report: ErasureReport) -> None:
        """Persist the erasure audit row (``erasure_audit``)."""
        ...


def erase_release_run(
    store: ErasureStore,
    release_run_id: str,
    *,
    requested_by: str,
    reason: str,
) -> ErasureReport:
    """Erase one run's personal data from Aurora + S3, audited and verified (Art.17).

    Order: delete S3 objects first, then the Aurora rows, then re-list the prefixes to prove
    nothing remains (fails closed with ``OrphanedObjectsError`` if it does). Idempotent: a
    second erasure of an already-cleared run deletes nothing and still records the audit.

    ``requested_by``/``reason`` are mandatory (constitution §7: a data-subject request is an
    escalation, never silent) and are recorded on the audit row.
    """
    if not _SAFE_RUN_ID.fullmatch(release_run_id):
        raise InvalidReleaseRunIdError("release_run_id is not a valid key segment")

    prefixes = _run_prefixes(release_run_id)

    objects_deleted = 0
    for prefix in prefixes:
        keys = store.list_objects(prefix)
        if keys:
            objects_deleted += store.delete_objects(keys)

    rows_deleted = store.delete_run_rows(release_run_id)

    # Verify Aurora: no run-scoped row may survive. The CASCADE from release_runs (plus the
    # explicit approvals delete) should clear every run-scoped table, so a non-zero count means
    # the deletion was partial — catch it before recording a (false) 'erased' result. (Mirrors
    # the S3 check below; delete_run_rows' rowcount alone does not prove the CASCADE completed.)
    remaining_rows = store.count_run_rows(release_run_id)
    if remaining_rows:
        raise OrphanedRowsError(
            f"{remaining_rows} run-scoped row(s) remain in Aurora "
            f"after erasure of run {release_run_id}"
        )

    # Verify S3: no object may survive under the run's prefixes (no presigned-reachable
    # remnant). This catches a partial delete before we record a (false) 'erased' result.
    remaining = tuple(key for prefix in prefixes for key in store.list_objects(prefix))
    if remaining:
        raise OrphanedObjectsError(
            f"{len(remaining)} object(s) remain after erasure of run {release_run_id}"
        )

    report = ErasureReport(
        release_run_id=release_run_id,
        requested_by=requested_by,
        reason=reason,
        rows_deleted=rows_deleted,
        objects_deleted=objects_deleted,
        s3_prefixes=prefixes,
        erased_at=datetime.now(UTC),
    )
    store.record_audit(report)
    return report


class InMemoryErasureStore:
    """In-process ``ErasureStore`` for unit/dev runs.

    Seeded with run rows and S3 objects; deletes mutate the in-memory state so a test can
    assert that BOTH stores are empty afterwards and that the audit row was recorded.
    """

    def __init__(self) -> None:
        self.run_rows: set[str] = set()
        self.objects: dict[str, bytes] = {}
        self.audits: list[ErasureReport] = []

    def seed_run(self, release_run_id: str) -> None:
        self.run_rows.add(release_run_id)

    def seed_object(self, key: str, body: bytes = b"x") -> None:
        self.objects[key] = body

    def delete_run_rows(self, release_run_id: str) -> int:
        if release_run_id in self.run_rows:
            self.run_rows.discard(release_run_id)
            return 1
        return 0

    def count_run_rows(self, release_run_id: str) -> int:
        return 1 if release_run_id in self.run_rows else 0

    def list_objects(self, prefix: str) -> tuple[str, ...]:
        return tuple(sorted(k for k in self.objects if k.startswith(prefix)))

    def delete_objects(self, keys: tuple[str, ...]) -> int:
        deleted = 0
        for key in keys:
            if self.objects.pop(key, None) is not None:
                deleted += 1
        return deleted

    def record_audit(self, report: ErasureReport) -> None:
        self.audits.append(report)
