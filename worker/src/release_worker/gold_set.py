"""T4 (spec 013) — the internal gold set loader (PRD §17.3).

A small, checked-in set of prior-release cases (``worker/gold_set/prior_releases.json``) used to
regression-test graph/prompt/model changes. Each case names a release boundary, the features
that should be surfaced as marketable, the approved copy a good draft echoes, the changes that
must NOT be marketed (noise), and the claims a correct pipeline must flag as risky/unsupported.

P5 (Safety rails) / stack-python: the file is untrusted-shaped input at a boundary, so it is
validated through Pydantic v2 (``GoldSet``) — never consumed as a raw dict. Constitution §5 /
domain-gdpr: the gold data is synthetic/internal only (no PII, customer names, or secrets); the
regression harness (``regression``) consumes these models, and the unit gate loads the real file
to prove it parses and is non-empty.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

# worker/src/release_worker/gold_set.py -> parents[2] == worker/ ; the data lives beside src.
DEFAULT_GOLD_SET_PATH = (
    Path(__file__).resolve().parents[2] / "gold_set" / "prior_releases.json"
)

_StrictModel = ConfigDict(frozen=True, extra="forbid")


class GoldCase(BaseModel):
    """One prior-release regression case (PRD §17.3). All five §17.3 elements are required so a
    half-specified case can't silently weaken the regression signal."""

    model_config = _StrictModel

    case_id: str = Field(min_length=1)
    base_ref: str = Field(min_length=1)
    head_ref: str = Field(min_length=1)
    expected_marketable_features: tuple[str, ...] = Field(min_length=1)
    approved_copy: tuple[str, ...] = Field(min_length=1)
    non_marketable_changes: tuple[str, ...] = Field(min_length=1)
    risky_claims: tuple[str, ...] = Field(min_length=1)


class GoldSet(BaseModel):
    """The validated gold set: a non-empty tuple of cases."""

    model_config = _StrictModel

    cases: tuple[GoldCase, ...] = Field(min_length=1)


def load_gold_set(path: Path | None = None) -> GoldSet:
    """Load + validate the gold set from disk (default: the checked-in file).

    Ignores any leading-underscore keys (e.g. the ``_comment`` provenance note) so the JSON can
    carry human documentation without polluting the strict model. Raises ``ValidationError`` on
    a malformed/empty file — fail-closed, so a broken gold set fails the harness rather than
    passing vacuously."""
    source = path or DEFAULT_GOLD_SET_PATH
    raw = json.loads(source.read_text(encoding="utf-8"))
    cases = raw.get("cases", []) if isinstance(raw, dict) else []
    return GoldSet.model_validate({"cases": cases})
