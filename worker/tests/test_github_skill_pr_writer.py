"""T3/T4 (spec 018) — the PR-based skill promotion writer (PRD §15.3 preferred mode).

Drives ``GitHubPullRequestSkillWriter`` against an injected fake transport (no network) so the live
GitHub sequence — resolve base → create branch → commit the file → open PR — is exercised in shape:

* §15.3 — the flow creates a branch, commits ``skills/<skill>/SKILL.md`` on it, and opens a PR;
  the returned ``PromotionResult`` carries the commit sha, the PR url, and ``promotion_mode='pr'``.
* AC2 — ``new_content_hash`` is the SAME sha256-of-bytes the direct writer records, so promotion
  provenance is mode-independent.
* github-rules (idempotent writes) — a retry (branch + PR already exist, 422) resolves the existing
  PR instead of failing or forking a second one.
* constitution §5 (blast radius) — a path that is not ``skills/**/SKILL.md`` is refused before any
  API call.
"""

from __future__ import annotations

import base64
import hashlib

import pytest

from release_worker.github_skill_pr_writer import (
    GitHubPullRequestSkillWriter,
    SkillPromotionPullRequestError,
    UnsafeSkillPathError,
)
from release_worker.skill_learning_models import PromotionMode

_REPO = "org/product"
_PATH = "skills/brand-voice/SKILL.md"
_CONTENT = "---\nname: brand-voice\nversion: 1.4.0\n---\n\nWrite with restraint.\n"


class FakeTransport:
    """A canned GitHub transport: routes (method, url) to a scripted (status, body) and records
    every call so a test can assert the sequence + payloads."""

    def __init__(self, responses: dict[tuple[str, str], tuple[int, object]]) -> None:
        self._responses = responses
        self.calls: list[tuple[str, str, object | None]] = []

    def __call__(
        self, method: str, url: str, payload: object | None
    ) -> tuple[int, object]:
        self.calls.append((method, url, payload))
        for (m, fragment), response in self._responses.items():
            if m == method and fragment in url:
                return response
        raise AssertionError(f"unexpected request: {method} {url}")


def _happy_responses() -> dict[tuple[str, str], tuple[int, object]]:
    return {
        ("GET", "/git/ref/heads/main"): (200, {"object": {"sha": "basesha"}}),
        ("POST", "/git/refs"): (201, {}),
        # The file does not yet exist on the fresh branch → 404 (a create, no blob sha).
        ("GET", "/contents/"): (404, {}),
        ("PUT", "/contents/"): (201, {"commit": {"sha": "commitsha123"}}),
        ("POST", "/pulls"): (
            201,
            {"html_url": "https://github.com/org/product/pull/7"},
        ),
    }


def _writer(
    responses: dict[tuple[str, str], tuple[int, object]],
) -> tuple[GitHubPullRequestSkillWriter, FakeTransport]:
    transport = FakeTransport(responses)
    writer = GitHubPullRequestSkillWriter(
        token="t0ken", repo=_REPO, base_branch="main", transport=transport
    )
    return writer, transport


def test_pr_mode_creates_branch_commits_file_and_opens_pr() -> None:
    writer, transport = _writer(_happy_responses())

    result = writer.replace_skill_file(_PATH, _CONTENT)

    # §15.3 — the result records the PR mode, the branch commit sha, and the opened PR url.
    assert result.promotion_mode is PromotionMode.PR
    assert result.commit_sha == "commitsha123"
    assert result.pr_url == "https://github.com/org/product/pull/7"
    # AC2 — the new content hash is the sha256 of the exact bytes (mode-independent provenance).
    assert result.new_content_hash == hashlib.sha256(_CONTENT.encode()).hexdigest()

    methods = [c[0] for c in transport.calls]
    # The flow ran in order: resolve base → create branch → read file → commit → open PR.
    assert methods == ["GET", "POST", "GET", "PUT", "POST"]

    # The branch ref was created off the resolved base sha.
    _, _, ref_payload = transport.calls[1]
    assert ref_payload["sha"] == "basesha"
    branch = ref_payload["ref"].removeprefix("refs/heads/")
    assert branch.startswith("skill-promotion/brand-voice-")

    # The file commit PUT carried the rendered file, base64-encoded, on that branch, at the path.
    put_call = next(c for c in transport.calls if c[0] == "PUT")
    assert _PATH in put_call[1]
    put_payload = put_call[2]
    assert put_payload["branch"] == branch
    assert base64.b64decode(put_payload["content"]).decode() == _CONTENT
    # A create (no existing blob) carries no 'sha'.
    assert "sha" not in put_payload

    # The PR was opened from the branch into the base.
    pr_payload = transport.calls[-1][2]
    assert pr_payload["head"] == branch
    assert pr_payload["base"] == "main"


def test_pr_mode_is_idempotent_on_retry() -> None:
    # A retry: the branch already exists (422) and the PR already exists (422); the writer resolves
    # the existing open PR rather than failing or opening a duplicate (github-rules: idempotent).
    responses = _happy_responses()
    responses[("POST", "/git/refs")] = (422, {"message": "Reference already exists"})
    responses[("POST", "/pulls")] = (422, {"message": "A pull request already exists"})
    responses[("GET", "/pulls?")] = (
        200,
        [{"html_url": "https://github.com/org/product/pull/7"}],
    )
    writer, _ = _writer(responses)

    result = writer.replace_skill_file(_PATH, _CONTENT)

    assert result.pr_url == "https://github.com/org/product/pull/7"
    assert result.promotion_mode is PromotionMode.PR


def test_pr_mode_refuses_a_path_outside_skills() -> None:
    writer, transport = _writer(_happy_responses())
    with pytest.raises(UnsafeSkillPathError):
        writer.replace_skill_file("../../etc/SKILL.md", _CONTENT)
    # Fail-closed BEFORE any API call (blast radius, §5).
    assert transport.calls == []


def test_pr_mode_raises_when_base_branch_cannot_be_resolved() -> None:
    responses = _happy_responses()
    responses[("GET", "/git/ref/heads/main")] = (404, {})
    writer, _ = _writer(responses)
    with pytest.raises(SkillPromotionPullRequestError):
        writer.replace_skill_file(_PATH, _CONTENT)
