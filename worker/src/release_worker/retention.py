"""T1 (spec 010) — retention/TTL policy + lawful-basis metadata for PII-bearing evidence.

P5 (Safety rails) / domain-gdpr-rules: GDPR Art.5(1)(c) data minimization, Art.5(1)(e)
storage limitation, and Art.6 lawful basis require that personal-data-bearing evidence
carries a *recorded* lawful basis + processing purpose and is deleted once its retention
window expires. The lawful basis/purpose/deadline are recorded structurally on every
``evidence_items`` row (migration 0009 NOT NULL DEFAULTs); this module owns the canonical
**policy** (the 180-day window + the default basis/purpose — kept in lockstep with the DDL)
and the deterministic TTL **sweep** that enforces storage limitation.

The sweep deletes an expired row AND its S3 blob (P5: deletion spans Aurora *and* S3, never
just one), mirroring the erasure path in ``release_worker.erasure``.

Pure stdlib + pydantic (no psycopg/boto3) so the unit gate exercises the sweep against an
in-memory fake; the Aurora/S3-backed ``ExpiredEvidenceStore`` lives in the runtime-only
``aurora_privacy`` module imported by the privacy CLI (anti-pattern #3: reachable through
``python -m release_worker.privacy retention-sweep``).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

# Canonical retention window. MUST match migration 0009's interval default so the DDL and
# the sweep never disagree about when a row is due for deletion.
DEFAULT_RETENTION_DAYS = 180

_StrictModel = ConfigDict(frozen=True, extra="forbid")


class LawfulBasis(StrEnum):
    """GDPR Art.6(1) lawful bases for processing personal data.

    This internal single-org tool processes release-evidence personal data under
    ``legitimate_interests`` (producing release content from the org's own repos); the
    enum is exhaustive so a future per-source basis is a value change, not a schema one.
    """

    CONSENT = "consent"
    CONTRACT = "contract"
    LEGAL_OBLIGATION = "legal_obligation"
    VITAL_INTERESTS = "vital_interests"
    PUBLIC_TASK = "public_task"
    LEGITIMATE_INTERESTS = "legitimate_interests"


class RetentionPolicy(BaseModel):
    """The recorded basis/purpose + TTL applied to a PII-bearing evidence row.

    Defaults match migration 0009's column DEFAULTs; ``processing_purpose`` honors Art.5(1)(b)
    purpose limitation (evidence is used only for content generation, never repurposed).
    """

    model_config = _StrictModel

    lawful_basis: LawfulBasis = LawfulBasis.LEGITIMATE_INTERESTS
    processing_purpose: str = Field(default="release_content_generation", min_length=1)
    retention_days: int = Field(default=DEFAULT_RETENTION_DAYS, gt=0)

    def expiry_for(self, created_at: datetime) -> datetime:
        """Return the retention deadline for a row created at ``created_at``.

        Measured from ``created_at`` (not "now") so a back-dated row expires on schedule.
        """
        return created_at + timedelta(days=self.retention_days)


# The single policy instance the worker applies; importing this keeps the DDL and code aligned.
DEFAULT_POLICY = RetentionPolicy()


class ExpiredEvidence(BaseModel):
    """One evidence row past its retention deadline — the unit the sweep deletes.

    Carries the S3 key of the redacted excerpt blob so the sweep can delete the Aurora row
    *and* the S3 object together (storage limitation must clear both stores).
    """

    model_config = _StrictModel

    evidence_id: str = Field(min_length=1)
    release_run_id: str = Field(min_length=1)
    raw_excerpt_s3_uri: str | None = None


class RetentionSweepReport(BaseModel):
    """Audit summary of one TTL sweep (what was deleted, as of when)."""

    model_config = _StrictModel

    swept_at: datetime
    rows_deleted: int = Field(ge=0)
    objects_deleted: int = Field(ge=0)
    evidence_ids: tuple[str, ...] = ()


@runtime_checkable
class ExpiredEvidenceStore(Protocol):
    """Durable store the sweep depends on (Aurora rows + S3 blobs).

    The runtime implementation (``aurora_privacy.AuroraS3ExpiredEvidenceStore``) reads
    ``evidence_items WHERE retention_expires_at < now`` and deletes the row + the S3 object;
    the in-memory fake mirrors that for the unit gate.
    """

    def list_expired(self, now: datetime) -> tuple[ExpiredEvidence, ...]:
        """Return every evidence row whose ``retention_expires_at`` is before ``now``."""
        ...

    def delete_evidence(self, item: ExpiredEvidence) -> bool:
        """Delete one row + its S3 blob. Returns ``True`` if an S3 object was removed."""
        ...


def sweep_expired_evidence(
    store: ExpiredEvidenceStore, *, now: datetime | None = None
) -> RetentionSweepReport:
    """Delete every PII-bearing evidence row past its retention deadline (Art.5(1)(e)).

    Deterministic and idempotent: a second sweep with nothing expired deletes nothing. The
    ``now`` cutoff is injectable for testing; production passes the current UTC time.
    """
    cutoff = now if now is not None else datetime.now(UTC)
    expired = store.list_expired(cutoff)
    objects_deleted = 0
    for item in expired:
        if store.delete_evidence(item):
            objects_deleted += 1
    return RetentionSweepReport(
        swept_at=cutoff,
        rows_deleted=len(expired),
        objects_deleted=objects_deleted,
        evidence_ids=tuple(item.evidence_id for item in expired),
    )


class InMemoryExpiredEvidenceStore:
    """In-process ``ExpiredEvidenceStore`` for unit/dev runs.

    Seeded with ``(ExpiredEvidence, retention_expires_at)`` pairs; ``list_expired`` applies
    the same ``< now`` predicate the SQL store uses, and ``delete_evidence`` drops the row and
    records the deleted S3 key so a test can prove both stores were cleared.
    """

    def __init__(self) -> None:
        self._rows: dict[str, tuple[ExpiredEvidence, datetime]] = {}
        self.deleted_objects: list[str] = []

    def seed(self, item: ExpiredEvidence, retention_expires_at: datetime) -> None:
        self._rows[item.evidence_id] = (item, retention_expires_at)

    def list_expired(self, now: datetime) -> tuple[ExpiredEvidence, ...]:
        return tuple(
            item for item, expires_at in self._rows.values() if expires_at < now
        )

    def delete_evidence(self, item: ExpiredEvidence) -> bool:
        self._rows.pop(item.evidence_id, None)
        if item.raw_excerpt_s3_uri is not None:
            self.deleted_objects.append(item.raw_excerpt_s3_uri)
            return True
        return False
