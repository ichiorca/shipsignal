"""T4 (spec 005) / T2-T5 (spec 006) — LangGraph graph state for ``content_generation_graph``.

P5 (Safety rails) + stack-python: all data threaded between nodes is validated Pydantic
v2, never a raw dict. Only redacted/approved structured data ever enters state —
``ApprovedFeature`` (built from redacted evidence), ``SkillSnapshot`` (repo-authored skill
metadata), ``ArtifactDraft`` (the generated draft), and the spec-006 claim/check layer
(``ArtifactClaim``, ``ClaimEvidenceLink``, ``PolicyFinding``). Nothing raw or un-validated
is carried (constitution §5).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from release_worker.claim_models import (
    ArtifactClaim,
    ClaimEvidenceLink,
    PolicyFinding,
)
from release_worker.content_models import (
    ApprovedFeature,
    ArtifactDraft,
    SkillSnapshot,
    SkillUsageEvent,
)
from release_worker.feature_models import GateDecision


class ContentRunState(BaseModel):
    """State threaded through ``content_generation_graph`` (PRD §5.3).

    Identifies the run + repo, then accumulates the approved features loaded, the skill
    snapshots taken, the draft artifacts generated, and their skill-usage events — the last
    two produced by ``generate_artifacts_parallel`` and written by ``persist_reviewable_artifacts``.
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
    # spec 006 — the claim/check layer threaded from extract_claims through Gate #2.
    claims: tuple[ArtifactClaim, ...] = ()
    claim_links: tuple[ClaimEvidenceLink, ...] = ()
    check_findings: tuple[PolicyFinding, ...] = ()
    # Set by the Gate #2 interrupt node when a human resumes with a decision (PRD §5.6).
    gate_decision: GateDecision | None = None
