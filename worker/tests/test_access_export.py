"""T3 (spec 010) — data-subject access export: escalation gate + run scoping (Art.15).

Exercises ``export_subject_data`` — the surface the privacy CLI invokes — against the
in-memory reader. Proves the two compliance invariants: (1) no data is assembled without an
approved escalation, and (2) the export contains ONLY the requested run's data.
"""

from __future__ import annotations

import pytest

from release_worker.access_export import (
    EscalationRequiredError,
    ExportApproval,
    InMemorySubjectDataReader,
    SubjectDataRecord,
    export_subject_data,
)

_RUN = "11111111-1111-4111-8111-111111111111"
_OTHER_RUN = "22222222-2222-4222-8222-222222222222"


def _record(evidence_id: str, excerpt: str) -> SubjectDataRecord:
    return SubjectDataRecord(
        evidence_id=evidence_id,
        evidence_type="code_diff",
        source="git_diff",
        redacted_excerpt=excerpt,
        lawful_basis="legitimate_interests",
        processing_purpose="release_content_generation",
        risk_flags=("email",),
    )


def _reader() -> InMemorySubjectDataReader:
    reader = InMemorySubjectDataReader()
    reader.seed(_RUN, (_record("ev-1", "owner [redacted-email]"),))
    reader.seed(_OTHER_RUN, (_record("ev-2", "other subject's data"),))
    return reader


def test_export_refuses_without_an_approved_escalation() -> None:
    """An unapproved request fails closed — nothing is read or returned (constitution §7)."""
    reader = _reader()

    with pytest.raises(EscalationRequiredError):
        export_subject_data(
            reader, _RUN, ExportApproval(approved=False, approver="dpo")
        )


def test_export_returns_only_the_requested_runs_data() -> None:
    reader = _reader()

    export = export_subject_data(
        reader, _RUN, ExportApproval(approved=True, approver="dpo@team")
    )

    assert export.release_run_id == _RUN
    assert export.approved_by == "dpo@team"
    assert [r.evidence_id for r in export.records] == ["ev-1"]
    # The other subject's record never appears in this export (scoping, constitution §2).
    assert all(r.evidence_id != "ev-2" for r in export.records)


def test_export_carries_redacted_excerpts_only() -> None:
    reader = _reader()

    export = export_subject_data(
        reader, _RUN, ExportApproval(approved=True, approver="dpo")
    )

    # The persisted excerpt is already redacted; the export cannot re-expose raw PII.
    assert export.records[0].redacted_excerpt == "owner [redacted-email]"
    assert "@" not in export.records[0].redacted_excerpt


def test_export_of_a_run_with_no_personal_data_is_an_empty_approved_export() -> None:
    reader = InMemorySubjectDataReader()

    export = export_subject_data(
        reader, _RUN, ExportApproval(approved=True, approver="dpo")
    )

    assert export.records == ()
    assert export.approved_by == "dpo"
