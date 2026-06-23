"""T2/T3/T4 (spec 002) — AC1/AC2/AC4 for the evidence-collection node chain.

Exercises the exact public surface the graph node wraps — ``collect_redact_persist``
and the individual nodes — against the in-memory fakes (anti-pattern #4: no private
helper, no DB/S3/network). The fakes record every blob and row that was persisted so
the redact-before-persist ordering is *proven* by inspecting what landed in storage,
not merely asserted by reading the code (AC1).
"""

from __future__ import annotations

import pytest

from release_worker.evidence_models import (
    CollectedEvidence,
    MalformedDiffError,
    ReleaseBoundary,
)
from release_worker.evidence_nodes import (
    collect_git_diff,
    collect_redact_persist,
    persist_evidence,
    redact_evidence,
)
from release_worker.evidence_ports import (
    InMemoryBoundaryReader,
    InMemoryEvidenceSink,
    StaticDiffSource,
    UnknownBoundaryError,
)

_RUN_ID = "11111111-1111-4111-8111-111111111111"
_BOUNDARY = ReleaseBoundary(
    release_run_id=_RUN_ID,
    repo="org/product",
    base_ref="v1.0.0",
    head_ref="v1.1.0",
)
# A diff whose patch text carries both an email (PII) and an AWS key (secret).
_DIRTY_PATCH = (
    "+ // owner: alice@example.com\n"
    "+ const KEY = 'AKIAIOSFODNN7EXAMPLE'\n"
    "+ renderChecklist()\n"
)
_WELL_FORMED_DIFF: dict[str, object] = {
    "repo": "org/product",
    "base_ref": "v1.0.0",
    "head_ref": "v1.1.0",
    "files": [
        {
            "file_path": "src/onboarding/Checklist.tsx",
            "status": "modified",
            "patch_text": _DIRTY_PATCH,
            "hunks": [{"line_range": "42-58", "patch": _DIRTY_PATCH}],
        }
    ],
}


def _reader() -> InMemoryBoundaryReader:
    reader = InMemoryBoundaryReader()
    reader.seed(_BOUNDARY)
    return reader


def test_collect_redact_persist_strips_pii_and_secret_before_storage() -> None:
    """AC1: nothing un-redacted reaches the S3 blob or the Aurora row."""
    sink = InMemoryEvidenceSink()

    records = collect_redact_persist(
        _RUN_ID, _reader(), StaticDiffSource(_WELL_FORMED_DIFF), sink
    )

    assert len(records) == 1
    # The raw PII/secret appears nowhere that was persisted: not in the blob bytes,
    # not in the inline redacted column.
    for blob in sink.blobs.values():
        assert "alice@example.com" not in blob
        assert "AKIAIOSFODNN7EXAMPLE" not in blob
    for row in sink.records:
        assert "alice@example.com" not in row.redacted_excerpt
        assert "AKIAIOSFODNN7EXAMPLE" not in row.redacted_excerpt
        assert row.risk_flags  # the redactor flagged what it stripped


def test_binary_files_with_empty_patch_produce_no_code_diff_evidence() -> None:
    """A binary/no-patch file (image, screenshot, lockfile blob) carries no diff content, so it
    must not create empty code_diff evidence (which would noise up clustering + waste S3 blobs).
    Only files with actual patch text become evidence."""
    diff: dict[str, object] = {
        "repo": "org/product",
        "base_ref": "v1.0.0",
        "head_ref": "v1.1.0",
        "files": [
            {
                "file_path": "docs/screenshot.png",
                "status": "added",
                "patch_text": "",
                "hunks": [],
            },
            {
                "file_path": "src/app.tsx",
                "status": "modified",
                "patch_text": "+ const x = 1\n",
                "hunks": [],
            },
        ],
    }
    collected = collect_git_diff(_BOUNDARY, StaticDiffSource(diff))
    assert [c.file_path for c in collected] == ["src/app.tsx"]


def test_persisted_row_carries_required_provenance_fields() -> None:
    """AC2: every evidence_items row has release_run_id, source, source_url, s3 uri."""
    sink = InMemoryEvidenceSink()

    records = collect_redact_persist(
        _RUN_ID, _reader(), StaticDiffSource(_WELL_FORMED_DIFF), sink
    )

    record = records[0]
    assert record.release_run_id == _RUN_ID
    assert record.source == "git_diff"
    assert record.source_url == "https://github.com/org/product/compare/v1.0.0...v1.1.0"
    assert record.raw_excerpt_s3_uri.startswith("s3://")
    assert record.raw_excerpt_s3_uri.endswith(".txt")
    assert record.file_path == "src/onboarding/Checklist.tsx"
    assert record.metadata["line_range"] == "42-58"


def test_redact_node_output_has_no_raw_field_for_persist() -> None:
    """The redact node maps to a type that structurally cannot carry raw text."""
    collected = collect_git_diff(_BOUNDARY, StaticDiffSource(_WELL_FORMED_DIFF))
    redacted = redact_evidence(collected)

    assert len(redacted) == 1
    # RedactedEvidence has no `raw_excerpt` attribute at all (constitution §5).
    assert not hasattr(redacted[0], "raw_excerpt")
    assert "alice@example.com" not in redacted[0].redacted_excerpt


def test_malformed_diff_fails_closed_with_user_safe_error() -> None:
    """AC4: a malformed payload raises MalformedDiffError without echoing content."""
    secret_bearing = {"repo": "org/product", "files": "AKIAIOSFODNN7EXAMPLE-oops"}

    with pytest.raises(MalformedDiffError) as exc:
        collect_git_diff(_BOUNDARY, StaticDiffSource(secret_bearing))

    # The user-safe message must not leak the offending payload.
    assert "AKIAIOSFODNN7EXAMPLE" not in str(exc.value)
    assert "malformed" in str(exc.value)


def test_unknown_run_raises_from_boundary_reader() -> None:
    with pytest.raises(UnknownBoundaryError):
        collect_redact_persist(
            "no-such-run",
            InMemoryBoundaryReader(),
            StaticDiffSource(_WELL_FORMED_DIFF),
            InMemoryEvidenceSink(),
        )


def test_empty_diff_persists_nothing() -> None:
    sink = InMemoryEvidenceSink()
    empty = {"repo": "org/product", "base_ref": "v1.0.0", "head_ref": "v1.1.0"}

    records = collect_redact_persist(_RUN_ID, _reader(), StaticDiffSource(empty), sink)

    assert records == ()
    assert sink.records == []
    assert sink.blobs == {}


def test_persist_stores_the_redacted_excerpt_in_the_blob() -> None:
    """The S3 object holds the redacted full excerpt and matches the inline column."""
    sink = InMemoryEvidenceSink()
    collected = (
        CollectedEvidence(
            evidence_type="code_diff",
            source="git_diff",
            repo="org/product",
            source_url="https://github.com/org/product/compare/v1.0.0...v1.1.0",
            file_path="a.txt",
            raw_excerpt="email bob@example.com",
        ),
    )

    records = persist_evidence(_RUN_ID, redact_evidence(collected), sink)

    key = records[0].raw_excerpt_s3_uri.split("/", 3)[3]
    assert sink.blobs[key] == records[0].redacted_excerpt
    assert "bob@example.com" not in sink.blobs[key]
