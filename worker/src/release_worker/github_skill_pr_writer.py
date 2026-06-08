"""T3 (spec 018) — ``GitHubPullRequestSkillWriter``: the PR-based skill promotion mode.

PRD §9.4.4 sentence 4 / §15.3 preferred production mode:

    approve → create branch → replace ``skills/<skill>/SKILL.md`` → open PR → record the
    resulting commit/PR SHA in Aurora.

This is the production counterpart of the hackathon-fast ``FilesystemRepoSkillWriter`` (direct
write to the checked-out tree). Both satisfy the ``RepoSkillWriter`` protocol; the graph reaches
either one ONLY on the approved branch of the Gate #3 interrupt, so no §9.4 invariant is relaxed —
the change still requires explicit human approval, lands at the SAME repo path, and records the
old+new hashes as provenance. The difference is purely HOW the replacement lands: a branch + PR a
human merges, rather than an overwrite of the working tree.

github-rules: authenticate with a server-side token from env (never argv/logs); every response
byte is untrusted, so each step reads only the fields it needs and fails closed with a secret-free
message. Uses stdlib ``urllib`` (dependency-policy). Imported only by ``__main__``/its factory at
runtime — the unit gate drives it against an injected fake transport (no network), so the live
GitHub path is exercised in shape without a real call.

constitution §5 (blast radius): the path is validated to ``skills/**/SKILL.md`` before any API
call, so a malformed candidate path can never open a PR touching an arbitrary repo file. The
branch name is a deterministic function of (path + content), so a transient-retry re-entry targets
the SAME branch/PR rather than forking a second one (idempotent — github-rules: make writes
idempotent).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable

from release_worker.skill_learning_models import PromotionMode, PromotionResult

_API_ROOT = "https://api.github.com"
_TIMEOUT_SECONDS = 30
# A short content-derived suffix keeps the branch name stable across a retry (same bytes → same
# branch) while staying well under git's ref length limit.
_BRANCH_PREFIX = "skill-promotion"
_HASH_SUFFIX_LEN = 12

# (method, url, json_payload_or_None) -> (status_code, parsed_json_body). The seam the unit gate
# fakes; the default implementation issues a real authenticated urllib request.
Transport = Callable[[str, str, object | None], tuple[int, object]]


class SkillPromotionPullRequestError(RuntimeError):
    """Raised when the PR-promotion flow cannot complete (a non-2xx GitHub response on a required
    step). User-safe: names the step that failed, never the token or response body."""

    def __init__(self, step: str) -> None:
        super().__init__(f"skill-promotion PR flow failed at step: {step}")


class UnsafeSkillPathError(ValueError):
    """The candidate ``skill_path`` is not a ``skills/**/SKILL.md`` — refuse to open a PR for it
    (constitution §5 blast radius). User-safe: echoes no path content."""

    def __init__(self) -> None:
        super().__init__("refusing to open a skill PR outside skills/**/SKILL.md")


def _validate_skill_path(skill_path: str) -> str:
    """Normalize + bound ``skill_path`` to ``skills/<...>/SKILL.md`` (no traversal, POSIX).

    Mirrors the ``FilesystemRepoSkillWriter`` blast-radius rule for the API path: the file must be
    named ``SKILL.md``, live under ``skills/``, and contain no ``..`` segment. Returns the cleaned
    POSIX path used verbatim as the Contents API path."""
    normalized = skill_path.replace("\\", "/")
    parts = [p for p in normalized.split("/") if p]
    if (
        not parts
        or parts[0] != "skills"
        or parts[-1] != "SKILL.md"
        or ".." in parts
        or len(parts) < 3
    ):
        raise UnsafeSkillPathError()
    return "/".join(parts)


class GitHubPullRequestSkillWriter:
    """Replace one repo ``SKILL.md`` by opening a pull request (PRD §15.3 preferred mode)."""

    def __init__(
        self,
        token: str,
        repo: str,
        base_branch: str,
        api_root: str = _API_ROOT,
        transport: Transport | None = None,
    ) -> None:
        self._token = token
        self._repo = repo
        self._base_branch = base_branch
        self._api_root = api_root.rstrip("/")
        self._transport = transport or self._default_transport

    @classmethod
    def from_env(cls) -> GitHubPullRequestSkillWriter:
        """Build from env: ``GITHUB_TOKEN`` + ``GITHUB_REPOSITORY`` (``owner/name``, set by Actions)
        + ``SKILL_PROMOTION_BASE_BRANCH`` (default ``main``). Fails fast with a secret-free message
        when a required var is missing (a misconfigured PR mode must not silently fall back)."""
        token = os.environ.get("GITHUB_TOKEN")
        repo = os.environ.get("GITHUB_REPOSITORY")
        if not token:
            raise RuntimeError("missing required environment variable: GITHUB_TOKEN")
        if not repo:
            raise RuntimeError(
                "missing required environment variable: GITHUB_REPOSITORY"
            )
        base_branch = os.environ.get("SKILL_PROMOTION_BASE_BRANCH") or "main"
        return cls(token, repo, base_branch)

    def _default_transport(
        self, method: str, url: str, payload: object | None
    ) -> tuple[int, object]:
        if not url.startswith("https://"):
            raise ValueError("refusing to call a non-https GitHub URL")
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        request = urllib.request.Request(url, data=data, method=method)
        request.add_header("Authorization", f"Bearer {self._token}")
        request.add_header("Accept", "application/vnd.github+json")
        request.add_header("X-GitHub-Api-Version", "2022-11-28")
        request.add_header("User-Agent", "shipsignal-release-worker")
        if data is not None:
            request.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
                body = response.read().decode("utf-8")
                return response.status, (json.loads(body) if body else {})
        except urllib.error.HTTPError as err:
            # Read the status (e.g. 404 missing file, 422 ref/PR already exists) so the caller can
            # branch idempotently; the body is parsed but never logged (it can echo the request).
            try:
                parsed = json.loads(err.read().decode("utf-8"))
            except (ValueError, OSError):
                parsed = {}
            return err.code, parsed

    def _send(
        self, method: str, path: str, payload: object | None = None
    ) -> tuple[int, object]:
        return self._transport(method, f"{self._api_root}{path}", payload)

    def _branch_name(self, skill_path: str, file_content: str) -> str:
        """Deterministic branch from (skill dir + content hash) so a retry reuses it (idempotent)."""
        skill_dir = skill_path.split("/")[-2]
        digest = hashlib.sha256(f"{skill_path}\x00{file_content}".encode()).hexdigest()
        return f"{_BRANCH_PREFIX}/{skill_dir}-{digest[:_HASH_SUFFIX_LEN]}"

    def _base_sha(self) -> str:
        status, body = self._send(
            "GET", f"/repos/{self._repo}/git/ref/heads/{self._base_branch}"
        )
        if status != 200 or not isinstance(body, dict):
            raise SkillPromotionPullRequestError("resolve base branch")
        obj = body.get("object")
        sha = obj.get("sha") if isinstance(obj, dict) else None
        if not isinstance(sha, str):
            raise SkillPromotionPullRequestError("resolve base branch")
        return sha

    def _ensure_branch(self, branch: str, base_sha: str) -> None:
        # 201 created; 422 means the ref already exists (a retry) — both are acceptable.
        status, _ = self._send(
            "POST",
            f"/repos/{self._repo}/git/refs",
            {"ref": f"refs/heads/{branch}", "sha": base_sha},
        )
        if status not in (201, 422):
            raise SkillPromotionPullRequestError("create branch")

    def _existing_blob_sha(self, skill_path: str, branch: str) -> str | None:
        # The Contents API update needs the current blob sha; 404 = file absent on the branch.
        path = urllib.parse.quote(skill_path)
        status, body = self._send(
            "GET", f"/repos/{self._repo}/contents/{path}?ref={branch}"
        )
        if (
            status == 200
            and isinstance(body, dict)
            and isinstance(body.get("sha"), str)
        ):
            return body["sha"]
        return None

    def _commit_file(
        self, skill_path: str, file_content: str, branch: str, blob_sha: str | None
    ) -> str:
        path = urllib.parse.quote(skill_path)
        payload: dict[str, object] = {
            "message": f"chore(skills): promote {skill_path} via approved candidate",
            "content": base64.b64encode(file_content.encode("utf-8")).decode("ascii"),
            "branch": branch,
        }
        if blob_sha is not None:
            payload["sha"] = blob_sha
        status, body = self._send(
            "PUT", f"/repos/{self._repo}/contents/{path}", payload
        )
        if status not in (200, 201) or not isinstance(body, dict):
            raise SkillPromotionPullRequestError("commit skill file")
        commit = body.get("commit")
        sha = commit.get("sha") if isinstance(commit, dict) else None
        if not isinstance(sha, str):
            raise SkillPromotionPullRequestError("commit skill file")
        return sha

    def _open_pull_request(self, skill_path: str, branch: str) -> str:
        status, body = self._send(
            "POST",
            f"/repos/{self._repo}/pulls",
            {
                "title": f"Promote skill {skill_path}",
                "head": branch,
                "base": self._base_branch,
                "body": (
                    "Automated skill promotion from an approved Gate #3 candidate "
                    "(PRD §15.3 PR mode). Merge to replace the canonical SKILL.md."
                ),
            },
        )
        if (
            status == 201
            and isinstance(body, dict)
            and isinstance(body.get("html_url"), str)
        ):
            return body["html_url"]
        if status == 422:
            # A PR for this head already exists (a retry) — resolve it instead of failing.
            existing = self._find_open_pull_request(branch)
            if existing is not None:
                return existing
        raise SkillPromotionPullRequestError("open pull request")

    def _find_open_pull_request(self, branch: str) -> str | None:
        owner = self._repo.split("/")[0]
        head = urllib.parse.quote(f"{owner}:{branch}", safe="")
        status, body = self._send(
            "GET", f"/repos/{self._repo}/pulls?head={head}&state=open"
        )
        if status == 200 and isinstance(body, list):
            for entry in body:
                if isinstance(entry, dict) and isinstance(entry.get("html_url"), str):
                    return entry["html_url"]
        return None

    def replace_skill_file(self, skill_path: str, file_content: str) -> PromotionResult:
        """Open a PR replacing ``skill_path`` with ``file_content`` (the §15.3 preferred flow).

        Validates the path to ``skills/**/SKILL.md`` (blast radius), creates the content-derived
        branch off the base, commits the rendered file on it, and opens a PR. Returns the commit
        sha of the branch commit + the ``new_content_hash`` of the bytes (the SAME digest the
        direct writer records, so AC2 provenance is mode-independent) + the opened PR url, tagged
        ``promotion_mode='pr'``. Idempotent on retry: a re-entry reuses the branch/PR.
        """
        safe_path = _validate_skill_path(skill_path)
        branch = self._branch_name(safe_path, file_content)
        base_sha = self._base_sha()
        self._ensure_branch(branch, base_sha)
        blob_sha = self._existing_blob_sha(safe_path, branch)
        commit_sha = self._commit_file(safe_path, file_content, branch, blob_sha)
        pr_url = self._open_pull_request(safe_path, branch)
        new_content_hash = hashlib.sha256(file_content.encode("utf-8")).hexdigest()
        return PromotionResult(
            commit_sha=commit_sha,
            new_content_hash=new_content_hash,
            promotion_mode=PromotionMode.PR,
            pr_url=pr_url,
        )
