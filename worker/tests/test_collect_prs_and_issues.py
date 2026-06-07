"""T1 (spec 003) — AC2/AC3/AC4 for the collect_prs_and_issues node.

Exercises the node through its public surface against the in-memory ``StaticPullRequestSource``
(anti-pattern #4). Asserts the typed PR/issue evidence and its provenance metadata, that a
malformed payload fails closed without echoing content (AC4), and — through the full
``collect_redact_persist_all`` chain — that untrusted PR/issue text is redacted before it
reaches the persisted blob or row (constitution §5 / AC2 "no raw PII in Aurora").
"""

from __future__ import annotations

import pytest

from release_worker.evidence_models import MalformedPullRequestError, ReleaseBoundary
from release_worker.evidence_nodes import (
    collect_prs_and_issues,
    collect_redact_persist_all,
)
from release_worker.evidence_ports import (
    InMemoryBoundaryReader,
    InMemoryEvidenceSink,
    StaticDiffSource,
    StaticPullRequestSource,
)

_RUN_ID = "22222222-2222-4222-8222-222222222222"
_BOUNDARY = ReleaseBoundary(
    release_run_id=_RUN_ID,
    repo="org/product",
    base_ref="v1.0.0",
    head_ref="v1.1.0",
)
# A PR/issue payload whose text carries PII (an email) and a secret (an AWS key).
_PRS: dict[str, object] = {
    "pull_requests": [
        {
            "number": 2214,
            "title": "Admin-configurable onboarding checklist",
            "body": "Ping carol@example.com — uses AKIAIOSFODNN7EXAMPLE for upload.",
            "labels": ["feature", "admin"],
            "reviewers": ["dlee"],
            "linked_issues": [
                {
                    "key": "#42",
                    "title": "Onboarding is manual",
                    "body": "Reported by erin@example.com",
                    "url": "https://github.com/org/product/issues/42",
                }
            ],
            "url": "https://github.com/org/product/pull/2214",
        }
    ]
}
_EMPTY_DIFF: dict[str, object] = {
    "repo": "org/product",
    "base_ref": "v1.0.0",
    "head_ref": "v1.1.0",
    "files": [],
}


def _reader() -> InMemoryBoundaryReader:
    reader = InMemoryBoundaryReader()
    reader.seed(_BOUNDARY)
    return reader


def test_collect_prs_and_issues_emits_typed_pr_and_issue_evidence() -> None:
    """AC3: PR + linked-issue evidence carry evidence_type, confidence, provenance."""
    collected = collect_prs_and_issues(_BOUNDARY, StaticPullRequestSource(_PRS))

    by_type = {item.evidence_type for item in collected}
    assert by_type == {"pr_metadata", "issue"}

    pr = next(i for i in collected if i.evidence_type == "pr_metadata")
    assert pr.source == "pr_metadata"
    assert pr.source_url == "https://github.com/org/product/pull/2214"
    assert pr.confidence == 1.0
    assert pr.metadata["pr_number"] == 2214
    assert pr.metadata["labels"] == "feature,admin"

    issue = next(i for i in collected if i.evidence_type == "issue")
    assert issue.metadata["issue_key"] == "#42"
    assert issue.metadata["pr_number"] == 2214


def test_collect_prs_and_issues_empty_payload_yields_nothing() -> None:
    assert collect_prs_and_issues(_BOUNDARY, StaticPullRequestSource({})) == ()


def test_collect_prs_and_issues_malformed_fails_closed() -> None:
    """AC4: a malformed payload raises a user-safe error without echoing content."""
    bad = {"pull_requests": "AKIAIOSFODNN7EXAMPLE-not-a-list"}

    with pytest.raises(MalformedPullRequestError) as exc:
        collect_prs_and_issues(_BOUNDARY, StaticPullRequestSource(bad))

    assert "AKIAIOSFODNN7EXAMPLE" not in str(exc.value)
    assert "malformed" in str(exc.value)


def test_pr_and_issue_text_is_redacted_before_persist() -> None:
    """AC2 / §5: no raw PII or secret from PR/issue text reaches the blob or row."""
    sink = InMemoryEvidenceSink()

    records = collect_redact_persist_all(
        _RUN_ID,
        _reader(),
        StaticDiffSource(_EMPTY_DIFF),
        StaticPullRequestSource(_PRS),
        sink,
    )

    assert {r.evidence_type for r in records} == {"pr_metadata", "issue"}
    for blob in sink.blobs.values():
        assert "carol@example.com" not in blob
        assert "erin@example.com" not in blob
        assert "AKIAIOSFODNN7EXAMPLE" not in blob
    for row in sink.records:
        assert "carol@example.com" not in row.redacted_excerpt
        assert "erin@example.com" not in row.redacted_excerpt
        assert "AKIAIOSFODNN7EXAMPLE" not in row.redacted_excerpt
