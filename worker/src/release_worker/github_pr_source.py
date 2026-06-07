"""T1 (spec 003) — runtime ``PullRequestSource`` backed by the GitHub REST API.

github-rules: authenticate with a server-side token from env (never argv/logs), treat
every byte of the response as untrusted (``collect_prs_and_issues`` validates it through
``PullRequestPayload``), and cut quota in collectors — we bound the commits walked, the
PRs resolved, and the issues fetched so a huge release can't exhaust the rate limit.

Strategy (deterministic, quota-bounded):
1. page the compare endpoint for the commits in ``base..head``;
2. resolve the PRs associated with those commits (``/commits/{sha}/pulls``), deduped;
3. parse ``#N`` / "closes #N" references out of each PR's title+body and fetch those
   issues for their user-story text (PRD §6.1 "Issues/Jira/Linear").

Uses stdlib ``urllib`` (dependency-policy). Imported only by ``__main__`` at runtime, so
the unit gate never makes a network call — it exercises the node against the fake.
"""

from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request

from release_worker.evidence_models import ReleaseBoundary

_API_ROOT = "https://api.github.com"
_PER_PAGE = 100
_TIMEOUT_SECONDS = 30
# Quota guards: far beyond a normal release, but a hard ceiling either way.
_MAX_COMMIT_PAGES = 30
_MAX_PRS = 100
_MAX_ISSUES = 100

# "#123" and "closes/fixes/resolves #123" issue references in PR title+body.
_ISSUE_REF = re.compile(r"#(\d+)\b")


class GitHubPullRequestSource:
    """Resolve PR metadata + linked issues for a compare range from GitHub."""

    def __init__(self, token: str, api_root: str = _API_ROOT) -> None:
        self._token = token
        self._api_root = api_root.rstrip("/")

    @classmethod
    def from_env(cls, env_var: str = "GITHUB_TOKEN") -> GitHubPullRequestSource:
        token = os.environ.get(env_var)
        if not token:
            raise RuntimeError(f"missing required environment variable: {env_var}")
        return cls(token)

    def _get(self, url: str) -> object:
        if not url.startswith("https://"):
            raise ValueError("refusing to fetch a non-https GitHub URL")
        request = urllib.request.Request(url, method="GET")
        request.add_header("Authorization", f"Bearer {self._token}")
        request.add_header("Accept", "application/vnd.github+json")
        request.add_header("X-GitHub-Api-Version", "2022-11-28")
        request.add_header("User-Agent", "shipsignal-release-worker")
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
            body = response.read().decode("utf-8")
        return json.loads(body)

    def _commit_shas(self, repo: str, base: str, head: str) -> list[str]:
        base_q = urllib.parse.quote(base, safe="")
        head_q = urllib.parse.quote(head, safe="")
        compare = f"{self._api_root}/repos/{repo}/compare/{base_q}...{head_q}"
        shas: list[str] = []
        for page in range(1, _MAX_COMMIT_PAGES + 1):
            payload = self._get(f"{compare}?per_page={_PER_PAGE}&page={page}")
            commits = payload.get("commits") if isinstance(payload, dict) else None
            if not isinstance(commits, list) or not commits:
                break
            for entry in commits:
                if isinstance(entry, dict) and isinstance(entry.get("sha"), str):
                    shas.append(entry["sha"])
            if len(commits) < _PER_PAGE:
                break
        return shas

    def _prs_for_commits(
        self, repo: str, shas: list[str]
    ) -> dict[int, dict[str, object]]:
        prs: dict[int, dict[str, object]] = {}
        for sha in shas:
            if len(prs) >= _MAX_PRS:
                break
            url = f"{self._api_root}/repos/{repo}/commits/{sha}/pulls?per_page={_PER_PAGE}"
            payload = self._get(url)
            if not isinstance(payload, list):
                continue
            for entry in payload:
                number = entry.get("number") if isinstance(entry, dict) else None
                if isinstance(number, int) and number not in prs:
                    prs[number] = entry
        return prs

    def _issue(self, repo: str, number: int) -> dict[str, object] | None:
        url = f"{self._api_root}/repos/{repo}/issues/{number}"
        payload = self._get(url)
        return payload if isinstance(payload, dict) else None

    def fetch_pull_requests(self, boundary: ReleaseBoundary) -> object:
        """Assemble an untrusted ``PullRequestPayload``-shaped dict for the boundary.

        Returns a plain dict (not a validated model) — ``collect_prs_and_issues`` owns
        validation so malformed GitHub responses fail closed there (AC4).
        """
        shas = self._commit_shas(boundary.repo, boundary.base_ref, boundary.head_ref)
        prs = self._prs_for_commits(boundary.repo, shas)

        issues_fetched = 0
        pull_requests: list[dict[str, object]] = []
        for number in sorted(prs):
            pr = prs[number]
            title = pr.get("title", "") if isinstance(pr, dict) else ""
            body = pr.get("body") or ""
            labels = [
                label.get("name", "")
                for label in (pr.get("labels") or [])
                if isinstance(label, dict)
            ]
            reviewers = [
                user.get("login", "")
                for user in (pr.get("requested_reviewers") or [])
                if isinstance(user, dict)
            ]

            linked_issues: list[dict[str, object]] = []
            referenced = {int(n) for n in _ISSUE_REF.findall(f"{title} {body}")}
            for issue_number in sorted(referenced):
                if issues_fetched >= _MAX_ISSUES:
                    break
                if issue_number == number:
                    continue  # the PR references itself
                issue = self._issue(boundary.repo, issue_number)
                issues_fetched += 1
                if issue is None or "pull_request" in issue:
                    continue  # the GitHub issues API returns PRs too; skip those
                linked_issues.append(
                    {
                        "key": f"#{issue_number}",
                        "title": issue.get("title", ""),
                        "body": issue.get("body") or "",
                        "url": issue.get("html_url"),
                    }
                )

            pull_requests.append(
                {
                    "number": number,
                    "title": title,
                    "body": body,
                    "labels": labels,
                    "reviewers": reviewers,
                    "linked_issues": linked_issues,
                    "url": pr.get("html_url") if isinstance(pr, dict) else None,
                }
            )

        return {"pull_requests": pull_requests}
