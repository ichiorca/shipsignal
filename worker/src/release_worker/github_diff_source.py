"""T2 (spec 002) — runtime ``DiffSource`` backed by the GitHub compare API.

github-rules: authenticate with a server-side token read from env (never argv/logs),
treat every byte of the response as untrusted (the collect node validates it through
Pydantic), and cut quota in collectors — we page the compare endpoint with a bounded
``per_page`` and a hard page cap so a huge release can't run the runner out of quota.

Uses ``urllib`` from the stdlib (dependency-policy: prefer stdlib over adding an HTTP
client). Imported only by ``__main__`` at runtime, so the unit gate never makes a
network call.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

from release_worker.evidence_models import ReleaseBoundary

_API_ROOT = "https://api.github.com"
_PER_PAGE = 100
# Hard cap on compare-API pages fetched per run (quota guard). 30 * 100 = 3000 files
# is far beyond a normal release; beyond it we stop rather than burn the rate limit.
_MAX_PAGES = 30
_TIMEOUT_SECONDS = 30


class GitHubDiffSource:
    """Fetch the changed files for a compare range from GitHub.

    The token is read from the environment at construction; missing token fails fast
    with a secret-free error (never embeds the value).
    """

    def __init__(self, token: str, api_root: str = _API_ROOT) -> None:
        self._token = token
        self._api_root = api_root.rstrip("/")

    @classmethod
    def from_env(cls, env_var: str = "GITHUB_TOKEN") -> GitHubDiffSource:
        token = os.environ.get(env_var)
        if not token:
            raise RuntimeError(f"missing required environment variable: {env_var}")
        return cls(token)

    def _get(self, url: str) -> dict[str, object]:
        if not url.startswith("https://"):
            raise ValueError("refusing to fetch a non-https GitHub URL")
        request = urllib.request.Request(url, method="GET")
        request.add_header("Authorization", f"Bearer {self._token}")
        request.add_header("Accept", "application/vnd.github+json")
        request.add_header("X-GitHub-Api-Version", "2022-11-28")
        request.add_header("User-Agent", "shipsignal-release-worker")
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8")
        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise ValueError("unexpected compare response shape")
        return parsed

    def fetch_raw_diff(self, boundary: ReleaseBoundary) -> object:
        """Page the compare endpoint and assemble an untrusted diff payload.

        Returns a plain dict (not a validated model) — ``collect_git_diff`` owns
        validation so malformed GitHub responses fail closed there (AC4).
        """
        base = urllib.parse.quote(boundary.base_ref, safe="")
        head = urllib.parse.quote(boundary.head_ref, safe="")
        compare = f"{self._api_root}/repos/{boundary.repo}/compare/{base}...{head}"

        files: list[dict[str, object]] = []
        for page in range(1, _MAX_PAGES + 1):
            url = f"{compare}?per_page={_PER_PAGE}&page={page}"
            payload = self._get(url)
            page_files = payload.get("files")
            if not isinstance(page_files, list) or not page_files:
                break
            for entry in page_files:
                if not isinstance(entry, dict):
                    continue
                files.append(
                    {
                        "file_path": entry.get("filename", ""),
                        "status": entry.get("status", ""),
                        "patch_text": entry.get("patch", ""),
                        "hunks": [],
                    }
                )
            if len(page_files) < _PER_PAGE:
                break

        return {
            "repo": boundary.repo,
            "base_ref": boundary.base_ref,
            "head_ref": boundary.head_ref,
            "files": files,
        }
