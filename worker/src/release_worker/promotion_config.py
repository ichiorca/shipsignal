"""T4 (spec 018) — config-selectable skill promotion mode (PRD §9.4.4 / §15.3).

A skill is promoted either by the hackathon-fast DIRECT write to the checked-out tree
(``FilesystemRepoSkillWriter``) or by the preferred production PR flow
(``GitHubPullRequestSkillWriter``). Which one runs is configuration, not a hardcoded constant —
``parse_promotion_mode`` reads the ``SKILL_PROMOTION_MODE`` env value, and ``build_repo_skill_writer``
constructs the matching writer.

``parse_promotion_mode`` is a pure function (no env/IO) so the unit gate tests selection + the
fail-closed behavior directly. ``build_repo_skill_writer`` is the runtime factory: it imports the
concrete writers lazily so importing this module for the parser never drags in a writer, and so the
selected mode is the ONLY writer constructed. An unknown mode fails closed (constitution §5 — never
guess how to write the repo) rather than defaulting silently.

The default is DIRECT: it works on the checked-out tree with no extra GitHub PR scope, so existing
single-org runs keep working unchanged; an operator opts into the preferred PR mode explicitly by
setting ``SKILL_PROMOTION_MODE=pr`` (PRD §15.3 names PR the preferred production path).
"""

from __future__ import annotations

from release_worker.skill_learning_models import PromotionMode
from release_worker.skill_learning_ports import RepoSkillWriter

# Default when the env var is unset/blank: the checked-out-tree direct write (no extra PR scope).
DEFAULT_PROMOTION_MODE = PromotionMode.DIRECT
PROMOTION_MODE_ENV = "SKILL_PROMOTION_MODE"


class UnknownPromotionModeError(ValueError):
    """Raised when ``SKILL_PROMOTION_MODE`` names a mode that is not ``direct`` or ``pr``.

    Fails closed: a typo'd mode must not silently fall back to a write the operator did not choose
    (constitution §5). User-safe — names the accepted values, not any secret."""

    def __init__(self, raw: str) -> None:
        accepted = ", ".join(m.value for m in PromotionMode)
        super().__init__(
            f"unknown skill promotion mode {raw!r}; expected one of: {accepted}"
        )


def parse_promotion_mode(raw: str | None) -> PromotionMode:
    """Parse the configured promotion mode (pure; T4, AC: mode is selectable via configuration).

    ``None``/blank → the DEFAULT (direct). A recognized value (case/space-insensitive) → that
    mode. Anything else raises ``UnknownPromotionModeError`` (fail closed). Kept free of env/IO so
    the selection logic is unit-tested without a process environment."""
    if raw is None or not raw.strip():
        return DEFAULT_PROMOTION_MODE
    normalized = raw.strip().lower()
    try:
        return PromotionMode(normalized)
    except ValueError as err:
        raise UnknownPromotionModeError(raw) from err


def build_repo_skill_writer(mode: PromotionMode) -> RepoSkillWriter:
    """Construct the ``RepoSkillWriter`` for ``mode`` from env (runtime factory; T4).

    Only the selected writer is built (lazy import), so the PR mode's GitHub env requirements are
    enforced only when PR mode is actually chosen and the direct mode needs no GitHub token. Both
    returned writers satisfy the ``RepoSkillWriter`` protocol the graph depends on; the graph reaches
    either one only on the approved Gate #3 branch (§9.4 invariants preserved by both)."""
    if mode is PromotionMode.PR:
        from release_worker.github_skill_pr_writer import GitHubPullRequestSkillWriter

        return GitHubPullRequestSkillWriter.from_env()
    from release_worker.repo_skill_writer import FilesystemRepoSkillWriter

    return FilesystemRepoSkillWriter.from_env()
