"""T4 (spec 018) — config selection of the skill promotion mode (PRD §9.4.4 / §15.3).

``parse_promotion_mode`` is the pure selection seam: the operator chooses DIRECT (hackathon-fast)
or PR (preferred production) via ``SKILL_PROMOTION_MODE``. The tests pin the default, the two
recognized values (case/space-insensitive), and the fail-closed behavior on an unknown mode (a
typo must not silently pick a write the operator did not choose — constitution §5).
"""

from __future__ import annotations

import pytest

from release_worker.promotion_config import (
    DEFAULT_PROMOTION_MODE,
    UnknownPromotionModeError,
    parse_promotion_mode,
)
from release_worker.skill_learning_models import PromotionMode


def test_default_is_direct_when_unset_or_blank() -> None:
    assert parse_promotion_mode(None) is DEFAULT_PROMOTION_MODE
    assert parse_promotion_mode("") is PromotionMode.DIRECT
    assert parse_promotion_mode("   ") is PromotionMode.DIRECT


def test_recognized_modes_are_selectable() -> None:
    assert parse_promotion_mode("pr") is PromotionMode.PR
    assert parse_promotion_mode("direct") is PromotionMode.DIRECT
    # Case- and whitespace-insensitive so a config value isn't brittle.
    assert parse_promotion_mode("  PR  ") is PromotionMode.PR
    assert parse_promotion_mode("Direct") is PromotionMode.DIRECT


def test_unknown_mode_fails_closed() -> None:
    with pytest.raises(UnknownPromotionModeError):
        parse_promotion_mode("merge-and-deploy")
