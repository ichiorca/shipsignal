"""T2 (spec 002) — the runtime GitHub compare ``DiffSource``.

github-rules: the collector pages with a bounded ``per_page`` and a hard page cap so a
huge release can't burn the rate limit; it refuses non-https URLs and fails fast when
the token is missing (without embedding the value). These tests fake ``urlopen`` so no
network call happens (the real module is otherwise runtime-only), exercising the
public ``fetch_raw_diff`` surface and proving the payload it builds is the untrusted
shape ``collect_git_diff`` validates.
"""

from __future__ import annotations

import io
import json

import pytest

from release_worker import github_diff_source as gds
from release_worker.evidence_models import ReleaseBoundary

_BOUNDARY = ReleaseBoundary(
    release_run_id="run-1",
    repo="org/product",
    base_ref="v1.0.0",
    head_ref="v1.1.0",
)


class _FakeResponse:
    def __init__(self, body: bytes) -> None:
        self._buf = io.BytesIO(body)

    def __enter__(self) -> _FakeResponse:
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def read(self) -> bytes:
        return self._buf.read()


def _install_pages(
    monkeypatch: pytest.MonkeyPatch, pages: list[list[dict]]
) -> list[str]:
    """Patch urlopen to serve ``pages`` (1-indexed by ?page=) and record fetched URLs."""
    seen: list[str] = []

    def fake_urlopen(request: object, timeout: int = 0) -> _FakeResponse:
        url = request.full_url  # type: ignore[attr-defined]
        seen.append(url)
        page = int(url.rsplit("page=", 1)[1])
        files = pages[page - 1] if page - 1 < len(pages) else []
        return _FakeResponse(json.dumps({"files": files}).encode("utf-8"))

    monkeypatch.setattr(gds.urllib.request, "urlopen", fake_urlopen)
    return seen


def test_from_env_fails_fast_without_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    with pytest.raises(RuntimeError) as exc:
        gds.GitHubDiffSource.from_env()
    assert "GITHUB_TOKEN" in str(exc.value)


def test_fetch_builds_untrusted_payload_from_compare_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_pages(
        monkeypatch,
        [
            [
                {
                    "filename": "src/a.tsx",
                    "status": "modified",
                    "patch": "+ added line",
                }
            ]
        ],
    )

    payload = gds.GitHubDiffSource(token="t").fetch_raw_diff(_BOUNDARY)

    assert isinstance(payload, dict)
    assert payload["repo"] == "org/product"
    files = payload["files"]
    assert isinstance(files, list) and len(files) == 1
    assert files[0] == {
        "file_path": "src/a.tsx",
        "status": "modified",
        "patch_text": "+ added line",
        "hunks": [],
    }


def test_paging_stops_on_a_short_page(monkeypatch: pytest.MonkeyPatch) -> None:
    # Shrink the page size so a 1-entry page is "short" and ends paging after page 1.
    monkeypatch.setattr(gds, "_PER_PAGE", 2)
    seen = _install_pages(
        monkeypatch,
        [[{"filename": "a", "status": "added", "patch": ""}]],  # 1 < per_page -> stop
    )

    payload = gds.GitHubDiffSource(token="t").fetch_raw_diff(_BOUNDARY)

    assert len(payload["files"]) == 1
    assert len(seen) == 1  # only page 1 was fetched


def test_paging_follows_full_pages_then_stops_on_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(gds, "_PER_PAGE", 2)
    full = [
        {"filename": "a", "status": "added", "patch": ""},
        {"filename": "b", "status": "added", "patch": ""},
    ]
    seen = _install_pages(monkeypatch, [full, []])  # full page then empty -> stop

    payload = gds.GitHubDiffSource(token="t").fetch_raw_diff(_BOUNDARY)

    assert len(payload["files"]) == 2
    assert len(seen) == 2  # page 1 (full) then page 2 (empty)


def test_normal_diff_is_not_marked_truncated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_pages(monkeypatch, [[{"filename": "a", "status": "added", "patch": ""}]])
    payload = gds.GitHubDiffSource(token="t").fetch_raw_diff(_BOUNDARY)
    assert payload["truncated"] is False


def test_hitting_the_compare_file_cap_marks_truncated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Shrink the cap so the test needn't synthesize 300 files. A page at the cap means GitHub
    # truncated the compare `files` array, so the payload must flag it (no silent partial diff).
    monkeypatch.setattr(gds, "_COMPARE_FILE_CAP", 2)
    _install_pages(
        monkeypatch,
        [
            [
                {"filename": "a", "status": "added", "patch": ""},
                {"filename": "b", "status": "added", "patch": ""},
            ]
        ],
    )
    payload = gds.GitHubDiffSource(token="t").fetch_raw_diff(_BOUNDARY)
    assert len(payload["files"]) == 2
    assert payload["truncated"] is True


def test_get_refuses_non_https_url() -> None:
    with pytest.raises(ValueError):
        gds.GitHubDiffSource(token="t")._get("http://api.github.com/x")
