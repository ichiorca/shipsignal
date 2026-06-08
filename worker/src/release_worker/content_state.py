"""T4 (spec 005) — LangGraph graph state for ``content_generation_graph``.

P5 (Safety rails) + stack-python: all data threaded between nodes is validated Pydantic
v2, never a raw dict. Only redacted/approved structured data ever enters state —
``ApprovedFeature`` (built from redacted evidence), ``SkillSnapshot`` (repo-authored skill
metadata), and ``ArtifactDraft`` (the generated draft). Nothing raw or un-validated is
carried (constitution §5).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from release_worker.content_models import (
    ApprovedFeature,
    ArtifactDraft,
    SkillSnapshot,
    SkillUsageEvent,
)


class ContentRunState(BaseModel):
    """State threaded through ``content_generation_graph`` (PRD §5.3).

    Identifies the run + repo, then accumulates the approved features loaded, the skill
    snapshots taken, the draft artifacts generated, and their skill-usage events — the last
    two produced by ``generate_artifacts`` and written by ``persist_reviewable_artifacts``.
    ``repo`` is needed to scope the skill snapshot rows (skills are repo-level, §10.5).
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    release_run_id: str = Field(min_length=1)
    thread_id: str = Field(min_length=1)
    repo: str = Field(min_length=1)
    approved_features: tuple[ApprovedFeature, ...] = ()
    skill_snapshots: tuple[SkillSnapshot, ...] = ()
    artifacts: tuple[ArtifactDraft, ...] = ()
    usage_events: tuple[SkillUsageEvent, ...] = ()
