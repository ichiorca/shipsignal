"""Integration: the worker's GitHub diff seam against the REAL GitHub API.

Double-gated (RUN_INTEGRATION=1 + RUN_GITHUB_INTEGRATION=1) and needs a real compare range
because diffs are repo-specific. Uses the actual app class (``GitHubDiffSource``) so the
test covers auth (token from env), the compare endpoint, and paging — i.e. an authorized
request to ``GITHUB_REPO`` returns a usable payload.
"""

from __future__ import annotations

import os

import pytest

from release_worker.evidence_models import ReleaseBoundary
from release_worker.github_diff_source import GitHubDiffSource


def test_github_diff_source_fetches_real_compare() -> None:
    if os.environ.get("RUN_GITHUB_INTEGRATION") != "1":
        pytest.skip("set RUN_GITHUB_INTEGRATION=1 (real GitHub API)")
    required = ("GITHUB_TOKEN", "GITHUB_REPO", "GITHUB_BASE_REF", "GITHUB_HEAD_REF")
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        pytest.skip(f"missing env for a real compare range: {', '.join(missing)}")

    boundary = ReleaseBoundary(
        release_run_id="it-github-0001",
        repo=os.environ["GITHUB_REPO"],
        base_ref=os.environ["GITHUB_BASE_REF"],
        head_ref=os.environ["GITHUB_HEAD_REF"],
    )
    raw = GitHubDiffSource.from_env().fetch_raw_diff(boundary)
    # The source returns the untrusted compare payload as a plain dict for the collector
    # to validate downstream — a dict back means auth + the compare call succeeded.
    assert isinstance(raw, dict)
