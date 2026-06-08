"""T2 (spec 005) — runtime ``SkillSource`` reading ``skills/**/SKILL.md`` from disk.

§9.1/§9.2: the repo is the canonical skill registry. On the Actions runner the repo is
checked out at a known commit; this reads each ``SKILL.md`` and tags it with that commit
sha so the snapshot node can record reproducible provenance. Pure stdlib (pathlib) — no
heavy dependency — but it is a filesystem boundary, so it is wired in by ``__main__`` and
covered by its own test against a temp tree (``test_repo_skill_source.py``).

constitution §5 (untrusted input): skill files are treated as data; their content is hashed
and snapshotted, never executed. The walk is bounded to ``SKILL.md`` files under the skills
root so an unrelated repo file can't masquerade as a skill.
"""

from __future__ import annotations

import os
from pathlib import Path

from release_worker.content_models import RawSkill


class FilesystemSkillSource:
    """List ``skills/**/SKILL.md`` files under a root, tagged with the repo commit sha."""

    def __init__(self, skills_root: Path, commit_sha: str) -> None:
        self._skills_root = skills_root
        self._commit_sha = commit_sha

    @classmethod
    def from_env(cls) -> FilesystemSkillSource:
        """Build from env: ``SKILLS_ROOT`` (default ``skills``) + the checkout commit.

        ``GITHUB_SHA`` is set by Actions; fall back to ``unknown`` so a local/dev run still
        snapshots (the content_hash, not the sha, is the tamper-evident key)."""
        root = Path(os.environ.get("SKILLS_ROOT", "skills"))
        commit_sha = os.environ.get("GITHUB_SHA") or "unknown"
        return cls(root, commit_sha)

    def list_skills(self) -> tuple[RawSkill, ...]:
        """Return every ``SKILL.md`` under the root as a ``RawSkill``.

        Paths are normalised to POSIX, relative to the current working directory when
        possible, so the snapshot's ``skill_path`` matches the repo path (§10.5). Sorted
        for a deterministic snapshot order. A missing root yields ``()`` (no skills yet)."""
        if not self._skills_root.is_dir():
            return ()
        skills: list[RawSkill] = []
        for path in sorted(self._skills_root.rglob("SKILL.md")):
            try:
                rel = path.relative_to(Path.cwd())
            except ValueError:
                rel = path
            skills.append(
                RawSkill(
                    skill_path=rel.as_posix(),
                    content=path.read_text(encoding="utf-8"),
                    commit_sha=self._commit_sha,
                )
            )
        return tuple(skills)
