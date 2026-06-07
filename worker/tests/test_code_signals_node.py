"""T2/T4 (spec 003) — AC1/AC2/AC3 for extract_code_signals, collect_docs_changes, and
the full ``collect_redact_persist_all`` chain.

Drives the nodes through their public surface (anti-pattern #4): the extractors turn a
validated diff into typed ``CollectedEvidence`` carrying ``evidence_type`` + ``confidence``
+ provenance metadata (line_range), and the end-to-end chain persists every collector's
output redacted, with the typed signals landing in the same ``evidence_items`` shape the
dashboard reads. The in-memory sink records what was persisted so redaction is proven by
inspection, not assertion (AC1/AC2).
"""

from __future__ import annotations

from release_worker.evidence_models import RawDiffPayload, ReleaseBoundary
from release_worker.evidence_nodes import (
    collect_docs_changes,
    collect_redact_persist_all,
    extract_code_signals,
)
from release_worker.evidence_ports import (
    InMemoryBoundaryReader,
    InMemoryEvidenceSink,
    StaticDiffSource,
    StaticPullRequestSource,
)

_RUN_ID = "33333333-3333-4333-8333-333333333333"
_BOUNDARY = ReleaseBoundary(
    release_run_id=_RUN_ID,
    repo="org/product",
    base_ref="v1.0.0",
    head_ref="v1.1.0",
)
_SOURCE_URL = "https://github.com/org/product/compare/v1.0.0...v1.1.0"

# A diff touching a UI component (with a PII comment), a route file, a migration, and a
# docs file — enough to fan several extractors at once.
_UI_PATCH = (
    "@@ -10,1 +10,3 @@ function Checklist()\n"
    " const x = 1\n"
    "+  // owner alice@example.com\n"
    "+  <button>Create onboarding checklist</button>\n"
)
_DOCS_PATCH = "@@ -1,0 +1,1 @@\n+## Admin onboarding checklists\n"
_DIFF: dict[str, object] = {
    "repo": "org/product",
    "base_ref": "v1.0.0",
    "head_ref": "v1.1.0",
    "files": [
        {
            "file_path": "src/onboarding/Checklist.tsx",
            "status": "modified",
            "patch_text": _UI_PATCH,
            "hunks": [],
        },
        {"file_path": "app/api/teams/route.ts", "status": "added", "patch_text": ""},
        {
            "file_path": "db/migrations/versions/0004_teams.py",
            "status": "added",
            "patch_text": "",
        },
        {"file_path": "README.md", "status": "modified", "patch_text": _DOCS_PATCH},
    ],
}


def _diff_model() -> RawDiffPayload:
    return RawDiffPayload.model_validate(_DIFF)


def _reader() -> InMemoryBoundaryReader:
    reader = InMemoryBoundaryReader()
    reader.seed(_BOUNDARY)
    return reader


def test_extract_code_signals_emits_typed_evidence_with_confidence_and_line() -> None:
    """AC3: each code signal carries evidence_type, confidence, and line provenance."""
    signals = extract_code_signals(_diff_model(), _SOURCE_URL)

    types = {s.evidence_type for s in signals}
    assert "ui_string_change" in types
    assert "route" in types
    assert "schema_change" in types

    ui = next(s for s in signals if s.evidence_type == "ui_string_change")
    assert ui.confidence is not None and 0.0 < ui.confidence <= 1.0
    assert ui.metadata["status"] == "modified"
    assert ui.metadata["line_range"] == "12"  # context(10) + comment(11) + button(12)
    assert ui.source == "git_diff"


def test_extract_code_signals_is_deterministic() -> None:
    """AC1: the same diff yields identical evidence across runs."""
    assert extract_code_signals(_diff_model(), _SOURCE_URL) == extract_code_signals(
        _diff_model(), _SOURCE_URL
    )


def test_collect_docs_changes_emits_docs_delta() -> None:
    evidence = collect_docs_changes(_diff_model(), _SOURCE_URL)
    assert [e.evidence_type for e in evidence] == ["docs_delta"]
    assert evidence[0].file_path == "README.md"


def test_full_chain_persists_typed_redacted_signals_with_confidence() -> None:
    """AC1/AC2/AC3: the end-to-end chain persists typed, redacted evidence; PII stripped,
    confidence carried into the row."""
    sink = InMemoryEvidenceSink()

    records = collect_redact_persist_all(
        _RUN_ID,
        _reader(),
        StaticDiffSource(_DIFF),
        StaticPullRequestSource({}),
        sink,
    )

    persisted_types = {r.evidence_type for r in records}
    # Whole-file diff evidence plus the granular code/docs signals coexist.
    assert {
        "code_diff",
        "ui_string_change",
        "route",
        "schema_change",
        "docs_delta",
    } <= (persisted_types)
    # AC2: the PII in the UI patch comment never reaches a persisted blob or row.
    for blob in sink.blobs.values():
        assert "alice@example.com" not in blob
    for row in sink.records:
        assert "alice@example.com" not in row.redacted_excerpt
    # AC3: at least the extractor-derived rows carry a confidence score.
    signal_rows = [r for r in records if r.evidence_type == "ui_string_change"]
    assert signal_rows and all(r.confidence is not None for r in signal_rows)
