"""T3 (spec 010) — data-subject ACCESS/export with an escalation-before-fulfillment gate.

P5 (Safety rails) / constitution §5 + §7: a subject may request a copy of the personal data
held about them (GDPR Art.15). Two non-negotiables:

* **Scope:** the export returns ONLY that subject's data — here the unit of tenancy is the
  ``release_run_id`` (constitution §2), so the reader is asked for exactly one run's
  personal-data-bearing rows and nothing else.
* **Escalation before fulfillment:** an access request is an escalation trigger, never a
  silent read (constitution §7). ``export_subject_data`` REFUSES to materialize anything
  unless it is handed an explicit, approved ``ExportApproval`` naming the human approver —
  so the data is never assembled, let alone returned, without a recorded human decision.

The export carries the *redacted* excerpt that was persisted (the raw excerpt never existed
in storage past the redaction gate, spec 002), so this surface cannot re-expose secrets and
keeps PII off any client by construction (the worker writes the export to a server-side
destination; it is never streamed to the browser).

Pure stdlib + pydantic (no psycopg/boto3) so the unit gate exercises the gate + scoping
against an in-memory fake; the Aurora-backed reader lives in the runtime-only
``aurora_privacy`` module, reachable via ``python -m release_worker.privacy export``.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

_StrictModel = ConfigDict(frozen=True, extra="forbid")


class EscalationRequiredError(RuntimeError):
    """Raised when an export is attempted without an approved escalation.

    Fails closed: no rows are read and nothing is returned until a human approves
    (constitution §7).
    """


class ExportApproval(BaseModel):
    """The recorded human decision that authorizes fulfilling an access request.

    ``approved`` must be ``True`` AND ``approver`` non-empty for the export to proceed; this
    is the escalation gate, not a rubber stamp the caller can default past.
    """

    model_config = _StrictModel

    approved: bool
    approver: str = Field(min_length=1)
    note: str | None = None


class SubjectDataRecord(BaseModel):
    """One personal-data-bearing row in a subject's export (a redacted evidence item)."""

    model_config = _StrictModel

    evidence_id: str = Field(min_length=1)
    evidence_type: str
    source: str
    source_url: str | None = None
    file_path: str | None = None
    redacted_excerpt: str
    lawful_basis: str
    processing_purpose: str
    risk_flags: tuple[str, ...] = ()


class SubjectDataExport(BaseModel):
    """The assembled access export for one run (subject), with the authorizing approver."""

    model_config = _StrictModel

    release_run_id: str = Field(min_length=1)
    approved_by: str = Field(min_length=1)
    exported_at: datetime
    records: tuple[SubjectDataRecord, ...] = ()


@runtime_checkable
class SubjectDataReader(Protocol):
    """Read the personal-data-bearing rows for exactly one run (the scoping boundary).

    The runtime implementation (``aurora_privacy.AuroraSubjectDataReader``) selects the run's
    ``evidence_items`` columns; the in-memory fake mirrors that for the unit gate.
    """

    def read_personal_data(self, release_run_id: str) -> tuple[SubjectDataRecord, ...]:
        """Return ONLY ``release_run_id``'s personal-data rows."""
        ...


def export_subject_data(
    reader: SubjectDataReader,
    release_run_id: str,
    approval: ExportApproval,
) -> SubjectDataExport:
    """Fulfill a data-subject access request for one run — only after escalation (Art.15).

    Refuses with ``EscalationRequiredError`` unless ``approval`` is approved AND names an
    approver; only then does it read the run-scoped rows. The reader is asked for exactly one
    ``release_run_id`` so the export cannot leak another subject's data.
    """
    if not approval.approved or not approval.approver:
        raise EscalationRequiredError(
            "data-subject access export requires an approved human escalation"
        )
    records = reader.read_personal_data(release_run_id)
    return SubjectDataExport(
        release_run_id=release_run_id,
        approved_by=approval.approver,
        exported_at=datetime.now(UTC),
        records=records,
    )


class InMemorySubjectDataReader:
    """In-process ``SubjectDataReader`` keyed by run, so a test can prove cross-run scoping."""

    def __init__(self) -> None:
        self._by_run: dict[str, tuple[SubjectDataRecord, ...]] = {}

    def seed(self, release_run_id: str, records: tuple[SubjectDataRecord, ...]) -> None:
        self._by_run[release_run_id] = records

    def read_personal_data(self, release_run_id: str) -> tuple[SubjectDataRecord, ...]:
        return self._by_run.get(release_run_id, ())
