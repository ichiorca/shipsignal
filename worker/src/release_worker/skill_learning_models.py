"""T2-T6 (spec 009) — Pydantic models for ``skill_learning_graph`` (PRD §5.5, §9.2-9.5, §10.5).

P5 (Safety rails) + stack-python: every payload threaded between nodes is a validated Pydantic
v2 model, never a raw dict. Two boundaries are untrusted (constitution §5): the mined review
signals (built from reviewer edits/notes — possibly residual text) and the Bedrock-drafted
skill body (``SkillRevisionDraft``). Both are validated here before anything is persisted; a
malformed draft fails closed as ``MalformedSkillDraftError`` without echoing its content.

§9.2 / AC4 — Aurora is the staging + provenance LEDGER, not the canonical registry: a
``SkillRevisionCandidate`` is a *proposal* only. The canonical skill stays the repo SKILL.md,
which is replaced (the single repo write) solely after an approved Gate #3 decision; the
``PromotionRecord`` columns are preserved afterward so the old/new hashes survive replacement
(§9.4.5 / AC2).
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

# Frozen + extra="forbid" everywhere: mined signals and model output are untrusted, so unknown
# fields are rejected rather than silently carried and values can't be mutated post-validation.
_StrictModel = ConfigDict(frozen=True, extra="forbid")


class LearningSignalType(StrEnum):
    """The kinds of learning signal mined from a run's Gate #1/#2 review (PRD §9.3 step 4)."""

    REVIEWER_EDIT = "reviewer_edit"
    REJECTED_CLAIM = "rejected_claim"
    REVIEW_NOTE = "review_note"


class RawReviewSignal(BaseModel):
    """One reviewer action mined from the run's recorded review data (the source port yields these).

    Built from approvals/rejections already in Aurora (Gate #1/#2 edits, rejected claims, notes).
    Treated as untrusted boundary data — validated here before it becomes a ``LearningSignal``.
    ``related_skill_snapshot_ids`` are the snapshots that were active for the reviewed artifact,
    so a signal can later be attributed to the skills that shaped the content.
    """

    model_config = _StrictModel

    signal_type: LearningSignalType
    artifact_id: str | None = None
    source_text: str = ""
    revised_text: str = ""
    reviewer: str | None = None
    rejection_category: str | None = None
    severity: str | None = None
    related_skill_snapshot_ids: tuple[str, ...] = ()


class LearningSignal(BaseModel):
    """A persisted ``learning_signals`` row (PRD §10.5).

    ``diff`` is a small structured before/after for an edit signal (the deterministic line-level
    removed/added sets) so the miner + reviewer can see what changed without re-diffing.
    """

    model_config = _StrictModel

    signal_id: str = Field(min_length=1)
    release_run_id: str = Field(min_length=1)
    artifact_id: str | None = None
    signal_type: str = Field(min_length=1)
    source_text: str = ""
    revised_text: str = ""
    diff: dict[str, tuple[str, ...]] = Field(default_factory=dict)
    reviewer: str | None = None
    rejection_category: str | None = None
    severity: str | None = None
    related_skill_snapshot_ids: tuple[str, ...] = ()


class SignalCluster(BaseModel):
    """A deterministic cluster of like learning signals (PRD §5.5 cluster_*_patterns).

    Clustering is rule-based (not a model call) so it is reproducible + testable (constitution
    §6: no model call for something a deterministic rule can decide). ``theme`` is the normalized
    pattern (e.g. ``reduce_hype``, ``remove_unsupported_metric``, a rejection category); it feeds
    the candidate's ``pattern_hash`` so a near-duplicate re-mine suppresses (§9.4.7).
    """

    model_config = _StrictModel

    signal_type: str = Field(min_length=1)
    theme: str = Field(min_length=1)
    signal_ids: tuple[str, ...] = Field(min_length=1)
    snapshot_ids: tuple[str, ...] = ()


class ActiveSkill(BaseModel):
    """The current active repo skill for a (repo, skill_path), resolved from a referenced snapshot.

    Carries the FULL current SKILL.md ``content`` (read from the checked-out repo — the canonical
    source, §9.2) plus the active ``snapshot_id`` + ``content_hash`` that the proposal is diffed
    against and that becomes ``old_content_hash`` at promotion (AC2).
    """

    model_config = _StrictModel

    snapshot_id: str = Field(min_length=1)
    repo: str = Field(min_length=1)
    skill_name: str = Field(min_length=1)
    skill_path: str = Field(min_length=1)
    skill_version: str | None = None
    content: str = Field(min_length=1)
    content_hash: str = Field(min_length=1)


class ImpactedSkill(BaseModel):
    """One skill the clustered signals touch, plus the clusters + signal evidence for it (PRD §5.5
    select_impacted_skills). The input to ``draft_skill_revision_candidate``."""

    model_config = _StrictModel

    skill: ActiveSkill
    clusters: tuple[SignalCluster, ...] = Field(min_length=1)
    supporting_signal_ids: tuple[str, ...] = Field(min_length=1)


class SkillRevisionDraft(BaseModel):
    """The validated Bedrock output for a proposed skill revision: a new body + reason.

    ``SkillRevisionDraft.model_validate`` is the single boundary check for the draft node
    (untrusted model output, constitution §5); a malformed payload raises ``ValidationError``
    which the node converts into a user-safe ``MalformedSkillDraftError``. The body is stored as
    text only — never executed.
    """

    model_config = _StrictModel

    proposed_body: str = Field(min_length=1)
    proposal_reason: str = Field(min_length=1)


class SkillRevisionCandidate(BaseModel):
    """A staged ``skill_revision_candidates`` row (PRD §10.5), always ``status='draft'`` at persist.

    The proposed body + frontmatter are a *proposal*; the canonical skill stays the repo file
    (§9.2). ``pattern_hash`` is the normalized signature used for cooldown suppression (§9.4.7).
    ``base_skill_snapshot_id`` + ``old_content_hash`` anchor the diff and the promotion record.
    """

    model_config = _StrictModel

    candidate_id: str = Field(min_length=1)
    repo: str = Field(min_length=1)
    skill_name: str = Field(min_length=1)
    skill_path: str = Field(min_length=1)
    base_skill_snapshot_id: str | None = None
    proposed_version: str = Field(min_length=1)
    proposed_body: str = Field(min_length=1)
    proposed_frontmatter: dict[str, str | bool] = Field(default_factory=dict)
    proposal_reason: str = Field(min_length=1)
    miner_type: str = Field(min_length=1)
    supporting_signal_ids: tuple[str, ...] = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    pattern_hash: str = Field(min_length=1)
    old_content_hash: str = Field(min_length=1)
    status: str = "draft"


class PromotionResult(BaseModel):
    """What a ``RepoSkillWriter`` returns after replacing a repo SKILL.md (the single repo write).

    The resulting ``commit_sha`` + the ``new_content_hash`` of the bytes written — recorded into
    the candidate row so the promotion is reproducible + tamper-evident (AC2).
    """

    model_config = _StrictModel

    commit_sha: str = Field(min_length=1)
    new_content_hash: str = Field(min_length=1)


class PromotionRecord(BaseModel):
    """The promotion provenance written to ``skill_revision_candidates`` on an approved Gate #3.

    Preserved after the repo file is replaced (§9.4.5 / AC2): the commit sha + old/new content
    hashes + reviewer + the candidate that was promoted.
    """

    model_config = _StrictModel

    candidate_id: str = Field(min_length=1)
    promoted_commit_sha: str = Field(min_length=1)
    old_content_hash: str = Field(min_length=1)
    new_content_hash: str = Field(min_length=1)
    reviewer: str | None = None


class Gate3Payload(BaseModel):
    """The JSON payload the Gate #3 interrupt surfaces to the dashboard (PRD §5.6, §9.5).

    Mirrors the gate-payload shape of Gate #1/#2: the gate name, the run + thread to resume, how
    many skill candidates await review, and the dashboard URL the reviewer opens.
    """

    model_config = _StrictModel

    gate: str = "skill_candidate_approval"
    release_run_id: str = Field(min_length=1)
    thread_id: str = Field(min_length=1)
    candidates_pending_review: int = Field(ge=0)
    dashboard_url: str = Field(min_length=1)


class SkillGateResolution(BaseModel):
    """The resolved Gate #3 decision (+ optional reviewer) returned by the interrupt.

    The resume value may be a bare decision string (parity with Gate #1/#2) or an object that also
    carries the reviewer so the promotion/rejection record names the human who decided (§10.5
    reviewed_by). Built by ``parse_skill_gate`` from the untrusted resume value.
    """

    model_config = _StrictModel

    decision: str = Field(min_length=1)
    reviewer: str | None = None


class MalformedSkillDraftError(ValueError):
    """Raised when a Bedrock skill-revision draft fails boundary validation.

    User-safe: never echoes the offending model output (it was built from review text and could
    carry residual sensitive content), only that it was rejected (constitution §5).
    """

    def __init__(self) -> None:
        super().__init__(
            "the model skill-revision draft was malformed and was rejected"
        )


class SkillCandidatePromotionBlockedError(ValueError):
    """Raised when a proposed skill body fails the §18.2 layer-3 pre-promotion content scan (T4,
    spec 016).

    Fails closed: a deterministic secret/named-entity hit or a Bedrock Guardrails intervention on
    the rendered candidate file blocks promotion BEFORE any repo SKILL.md is written (constitution
    §5 — no unsafe overwrite). The codes that fired are carried for the audit trail; the message is
    user-safe and never echoes the matched value.
    """

    def __init__(self, codes: tuple[str, ...]) -> None:
        self.codes = codes
        super().__init__(
            "skill candidate blocked by pre-promotion content scan; promotion refused"
        )
