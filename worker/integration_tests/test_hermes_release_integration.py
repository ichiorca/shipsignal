"""Integration: the core diff→evidence pipeline against the REAL GitHub compare API, pinned to the
exact releases the deterministic e2e test fixtures capture — so that fixture cannot silently drift
from what GitHub actually returns.

Releases (NousResearch/hermes-agent):
    "Hermes Agent v0.14.0" -> git tag v2026.5.16   (base_ref)
    "Hermes Agent v0.17.0" -> git tag v2026.6.19   (head_ref)

Double-gated: RUN_INTEGRATION=1 (conftest collect-ignore) AND RUN_GITHUB_INTEGRATION=1, plus a
GITHUB_TOKEN for ``GitHubDiffSource.from_env``. Uses the production ``GitHubDiffSource`` so the test
covers auth, the compare endpoint, and the 300-file cap behaviour against live data.
"""

from __future__ import annotations

import os

import pytest

from release_worker.evidence_models import ReleaseBoundary
from release_worker.evidence_nodes import collect_redact_persist_all
from release_worker.evidence_ports import (
    InMemoryBoundaryReader,
    InMemoryEvidenceSink,
    StaticPullRequestSource,
)
from release_worker.github_diff_source import GitHubDiffSource

_REPO = "NousResearch/hermes-agent"
_BASE_REF = "v2026.5.16"  # Hermes Agent v0.14.0
_HEAD_REF = "v2026.6.19"  # Hermes Agent v0.17.0
_RUN_ID = "it-hermes-0001"


def _require_live() -> None:
    if os.environ.get("RUN_GITHUB_INTEGRATION") != "1":
        pytest.skip("set RUN_GITHUB_INTEGRATION=1 (real GitHub API)")
    if not os.environ.get("GITHUB_TOKEN"):
        pytest.skip("missing GITHUB_TOKEN for GitHubDiffSource.from_env")


def test_live_hermes_compare_returns_changed_files() -> None:
    """The real compare for v0.14.0...v0.17.0 returns a usable diff payload with changed files."""
    _require_live()
    boundary = ReleaseBoundary(
        release_run_id=_RUN_ID, repo=_REPO, base_ref=_BASE_REF, head_ref=_HEAD_REF
    )
    raw = GitHubDiffSource.from_env().fetch_raw_diff(boundary)
    assert isinstance(raw, dict)
    files = raw.get("files")
    assert isinstance(files, list) and files, (
        "expected changed files in the compare payload"
    )
    # KNOWN GAP (coverage): GitHub caps the compare `files` array at 300 (path-sorted). This span is
    # 3000+ commits, so the worker only ever sees the first 300 files — assert we observe the cap so
    # a future de-truncation change (per-commit / .diff media type) is caught here against live data.
    assert len(files) <= 300


def test_live_hermes_pipeline_extracts_evidence() -> None:
    """End-to-end against live GitHub: the real diff flows through collect→redact→persist and yields
    code-diff evidence (the same shape the deterministic fixture test asserts offline)."""
    _require_live()
    boundary = ReleaseBoundary(
        release_run_id=_RUN_ID, repo=_REPO, base_ref=_BASE_REF, head_ref=_HEAD_REF
    )
    reader = InMemoryBoundaryReader()
    reader.seed(boundary)
    records = collect_redact_persist_all(
        _RUN_ID,
        reader,
        GitHubDiffSource.from_env(),
        StaticPullRequestSource({}),
        InMemoryEvidenceSink(),
    )
    assert records, "expected evidence from the live Hermes compare"
    assert any(r.evidence_type == "code_diff" for r in records)
    # Redaction must never leak: no persisted excerpt may carry a raw GitHub/AWS/PEM secret.
    import re

    raw_secret = re.compile(
        r"ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----"
    )
    for r in records:
        assert not raw_secret.search(r.redacted_excerpt)
