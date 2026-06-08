"""T2-T6 (spec 009) — LangGraph graph state for ``skill_learning_graph`` (PRD §5.5).

P5 (Safety rails) + stack-python: every value threaded between nodes is validated Pydantic v2,
never a raw dict. The state accumulates the mined signals, the edit/rejection clusters, the
impacted skills, the staged candidates, and — only after the Gate #3 interrupt resolves — the
resolution and the promotion records. ``gate_resolution`` is set solely by the interrupt node,
so a run halted at Gate #3 never carries a decision (constitution §5: no self-approval).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from release_worker.skill_learning_models import (
    ImpactedSkill,
    LearningSignal,
    PromotionRecord,
    SignalCluster,
    SkillGateResolution,
    SkillRevisionCandidate,
)


class SkillLearningState(BaseModel):
    """State threaded through ``skill_learning_graph`` (PRD §5.5).

    Identifies the run + thread + repo, then accumulates: the mined learning signals, the edit and
    rejection clusters, the impacted skills, the staged revision candidates, the resolved Gate #3
    decision, and the promotion records written on the approved branch.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    release_run_id: str = Field(min_length=1)
    thread_id: str = Field(min_length=1)
    repo: str = Field(min_length=1)

    signals: tuple[LearningSignal, ...] = ()
    edit_clusters: tuple[SignalCluster, ...] = ()
    rejection_clusters: tuple[SignalCluster, ...] = ()
    impacted_skills: tuple[ImpactedSkill, ...] = ()
    candidates: tuple[SkillRevisionCandidate, ...] = ()
    gate_resolution: SkillGateResolution | None = None
    promotion_records: tuple[PromotionRecord, ...] = ()
