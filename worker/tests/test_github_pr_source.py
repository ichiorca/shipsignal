"""The runtime GitHub ``PullRequestSource`` — quota-cap truncation surfacing (gap C fix).

github-rules: PR/issue collection is quota-bounded (``_MAX_PRS`` / ``_MAX_ISSUES``). When a cap is
hit the result is partial, so the payload must FLAG it (mirroring ``RawDiffPayload.truncated`` for
the file diff) instead of silently returning a subset. These tests fake ``_get`` so no network call
happens, routing by URL to drive the commit→PR resolution.
"""

from __future__ import annotations

import pytest

from release_worker import github_pr_source as gps
from release_worker.evidence_models import ReleaseBoundary

_BOUNDARY = ReleaseBoundary(
    release_run_id="run-1", repo="org/product", base_ref="v1.0.0", head_ref="v1.1.0"
)


def _route(payloads: dict[str, object]):
    """Return a fake ``_get(url)`` that serves a payload by the first matching URL substring."""

    def fake_get(url: str) -> object:
        for needle, payload in payloads.items():
            if needle in url:
                return payload
        return [] if "/pulls" in url else {}

    return fake_get


def test_hitting_the_pr_cap_flags_truncated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(gps, "_MAX_PRS", 1)  # cap at 1 so two PRs trip it
    src = gps.GitHubPullRequestSource(token="t")
    monkeypatch.setattr(
        src,
        "_get",
        _route(
            {
                "/compare/": {"commits": [{"sha": "a"}, {"sha": "b"}]},
                "/commits/a/pulls": [
                    {"number": 1, "title": "PR one", "body": "", "labels": []}
                ],
                "/commits/b/pulls": [
                    {"number": 2, "title": "PR two", "body": "", "labels": []}
                ],
            }
        ),
    )

    payload = src.fetch_pull_requests(_BOUNDARY)

    assert isinstance(payload, dict)
    assert payload["truncated"] is True  # the cap was hit → result is partial
    assert len(payload["pull_requests"]) == 1  # only up to the cap collected


def test_under_the_cap_is_not_truncated(monkeypatch: pytest.MonkeyPatch) -> None:
    src = gps.GitHubPullRequestSource(token="t")
    monkeypatch.setattr(
        src,
        "_get",
        _route(
            {
                "/compare/": {"commits": [{"sha": "a"}]},
                "/commits/a/pulls": [
                    {"number": 1, "title": "PR one", "body": "", "labels": []}
                ],
            }
        ),
    )

    payload = src.fetch_pull_requests(_BOUNDARY)

    assert payload["truncated"] is False
    assert len(payload["pull_requests"]) == 1
