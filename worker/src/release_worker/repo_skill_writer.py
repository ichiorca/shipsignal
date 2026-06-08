"""T6 (spec 009) — runtime ``RepoSkillWriter`` that replaces a repo ``SKILL.md`` on disk.

constitution §5 (blast radius): the ONLY file the system overwrites is the approved
``skills/**/SKILL.md``, and only after Gate #3. This writer is the single repo-write boundary;
it is reached only by ``update_repo_skill_file`` on the approved branch of the interrupt. It
hard-enforces that the target stays under the skills root and is named ``SKILL.md`` — a path that
escapes (traversal) or names any other file is refused, so a malformed candidate path can never
overwrite an arbitrary repo file.

Imported only by ``__main__`` at runtime (it touches the filesystem), so the unit gate never
imports it — the node logic is tested against ``InMemoryRepoSkillWriter`` instead. Pure stdlib
(pathlib/hashlib) — no new dependency.

§9.4.3/§9.4.4 — promotion replaces the file at the SAME repo path (hackathon-fast direct write
to the checked-out tree); the resulting ``commit_sha`` is the checkout sha (``GITHUB_SHA`` on the
Actions runner) recorded as provenance. A PR-based flow can later replace this implementation
without touching the node logic.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

from release_worker.skill_learning_models import PromotionResult


class UnsafeSkillPathError(ValueError):
    """Raised when an approved candidate's ``skill_path`` escapes the skills root or is not a
    ``SKILL.md``. Fails closed — the system writes nothing outside the sanctioned blast radius
    (constitution §5). User-safe: echoes no path content."""

    def __init__(self) -> None:
        super().__init__("refusing to write a skill file outside skills/**/SKILL.md")


class FilesystemRepoSkillWriter:
    """Replace ``skills/**/SKILL.md`` on the checked-out repo with an approved body (PRD §9.4)."""

    def __init__(self, skills_root: Path, commit_sha: str) -> None:
        self._skills_root = skills_root.resolve()
        self._commit_sha = commit_sha

    @classmethod
    def from_env(cls) -> FilesystemRepoSkillWriter:
        """Build from env: ``SKILLS_ROOT`` (default ``skills``) + the checkout commit sha.

        ``GITHUB_SHA`` is set by Actions; fall back to ``unknown`` so a local/dev promotion still
        records a (non-reproducible) sha — the content hashes, not the sha, are the tamper-evident
        provenance (AC2)."""
        root = Path(os.environ.get("SKILLS_ROOT", "skills"))
        commit_sha = os.environ.get("GITHUB_SHA") or "unknown"
        return cls(root, commit_sha)

    def _safe_target(self, skill_path: str) -> Path:
        """Resolve ``skill_path`` and refuse anything that escapes the skills root or is not a
        ``SKILL.md`` (no traversal, no arbitrary repo file — constitution §5)."""
        if Path(skill_path).name != "SKILL.md":
            raise UnsafeSkillPathError()
        target = (Path.cwd() / skill_path).resolve()
        if (
            self._skills_root != target.parent
            and self._skills_root not in target.parents
        ):
            raise UnsafeSkillPathError()
        return target

    def replace_skill_file(self, skill_path: str, file_content: str) -> PromotionResult:
        """Overwrite the approved skill file with ``file_content`` and return the promotion result.

        Computes the new content hash from the exact bytes written (the ``new_content_hash``
        recorded in Aurora, AC2) and returns it with the checkout ``commit_sha``. The parent
        directory must already exist (the skill is being *replaced*, not created)."""
        target = self._safe_target(skill_path)
        if not target.parent.is_dir():
            raise UnsafeSkillPathError()
        encoded = file_content.encode("utf-8")
        target.write_bytes(encoded)
        new_content_hash = hashlib.sha256(encoded).hexdigest()
        return PromotionResult(
            commit_sha=self._commit_sha, new_content_hash=new_content_hash
        )
