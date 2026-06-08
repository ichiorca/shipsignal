"""T2 (spec 005) — FilesystemSkillSource reads skills/**/SKILL.md from a checked-out repo.

Pure stdlib filesystem boundary, so it is covered here against a temp tree (not orphaned).
Asserts it finds nested SKILL.md files, tags them with the commit sha, normalises the path
to POSIX, and returns () for a missing skills root (a repo with no skills yet).
"""

from __future__ import annotations

from pathlib import Path

from release_worker.repo_skill_source import FilesystemSkillSource


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_lists_nested_skill_files_with_commit_sha(tmp_path: Path) -> None:
    root = tmp_path / "skills"
    _write(root / "brand-voice" / "SKILL.md", "---\nname: brand-voice\n---\nbody")
    _write(root / "blog-format" / "SKILL.md", "---\nname: blog-format\n---\nbody")
    # A non-SKILL file must be ignored.
    _write(root / "brand-voice" / "README.md", "ignore me")

    source = FilesystemSkillSource(root, "sha-xyz")
    skills = source.list_skills()

    assert len(skills) == 2
    assert all(s.commit_sha == "sha-xyz" for s in skills)
    assert all(s.skill_path.endswith("/SKILL.md") for s in skills)
    assert all("\\" not in s.skill_path for s in skills)  # POSIX-normalised


def test_missing_root_returns_empty(tmp_path: Path) -> None:
    source = FilesystemSkillSource(tmp_path / "no-skills-here", "sha")
    assert source.list_skills() == ()
