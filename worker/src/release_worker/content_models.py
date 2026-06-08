"""T2/T3/T4/T5 (spec 005) — Pydantic models for the content_generation_graph's first
slice (PRD §5.3, §8.1 blog/changelog, §9 skills, §10.3 artifacts, §10.5 skill provenance).

P5 (Safety rails) + stack-python: each boundary payload is a validated Pydantic v2 model,
never a raw dict. Two boundaries matter here:

* Bedrock artifact output is *untrusted model text* (constitution §5) — it is validated
  through ``GeneratedArtifact`` before any of it is persisted; a malformed response fails
  closed as ``MalformedArtifactOutputError`` without echoing the offending content.
* Skill files read from the repo are untrusted input too — the parsed frontmatter is
  coerced to a flat ``str | bool`` map so a malformed skill header cannot smuggle nested
  structures into Aurora.

§9.2 — Aurora is the skills *provenance ledger*, not the canonical registry: a
``SkillSnapshot`` records (repo, skill_path, commit_sha, content_hash) of the repo
SKILL.md that was loaded; the canonical source stays the repo file. Every ``ArtifactDraft``
is persisted ``status='draft'`` (no self-approval, §5) and carries the model/prompt/skill
versions that produced it (§18.3 audit trail).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, computed_field

from release_worker.content_hash import artifact_content_hash

# Frozen + extra="forbid" everywhere: skill files and model output are untrusted input,
# so unknown fields are rejected rather than silently carried, and values can't be mutated
# after validation.
_StrictModel = ConfigDict(frozen=True, extra="forbid")


class RawSkill(BaseModel):
    """One ``skills/**/SKILL.md`` file as read from the checked-out repo (pre-parse).

    ``content`` is the whole file (frontmatter + body); the snapshot node parses it and
    computes the content hash. ``commit_sha`` is the repo HEAD the checkout is at — the
    same value across every skill in one run, so the snapshot is reproducible (§9.3).
    """

    model_config = _StrictModel

    skill_path: str = Field(min_length=1)  # e.g. "skills/brand-voice/SKILL.md"
    content: str
    commit_sha: str = Field(min_length=1)


class SkillSnapshot(BaseModel):
    """A persisted ``skill_repo_snapshots`` row (PRD §10.5).

    Records exactly which repo skill (by path + commit + content hash) was loaded for a
    run. ``is_active`` marks the snapshot matching the current commit. The canonical skill
    remains the repo SKILL.md — this is provenance, not the source of truth (§9.2).
    """

    model_config = _StrictModel

    snapshot_id: str = Field(min_length=1)
    repo: str = Field(min_length=1)
    skill_name: str = Field(min_length=1)
    skill_path: str = Field(min_length=1)
    skill_version: str | None = None
    commit_sha: str = Field(min_length=1)
    content_hash: str = Field(min_length=1)
    frontmatter: dict[str, str | bool] = Field(default_factory=dict)
    body_excerpt: str = ""
    is_active: bool = True


class ApprovedFeature(BaseModel):
    """A Gate#1-approved ``feature_clusters`` row, loaded for content generation (PRD §7).

    Only the narrative fields generation needs — never scores or raw evidence. By the time
    a feature is here it is ``status='approved'``; the reader filters to approved only, so
    rejected/edited features can never flow into generation (constitution §5).
    """

    model_config = _StrictModel

    feature_id: str = Field(min_length=1)
    release_run_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    summary_internal: str = ""
    user_value: str = ""
    audiences: tuple[str, ...] = ()
    change_type: str | None = None
    surface_area: tuple[str, ...] = ()


class GeneratedArtifact(BaseModel):
    """The validated Bedrock output for one artifact: title + Markdown body.

    ``GeneratedArtifact.model_validate`` is the single boundary check for the generation
    node (AC: "validated, Pydantic-checked output"); a malformed payload raises
    ``ValidationError`` which the node converts into a user-safe
    ``MalformedArtifactOutputError`` (AC4 / §5).
    """

    model_config = _StrictModel

    title: str = Field(min_length=1)
    body_markdown: str = Field(min_length=1)


class ArtifactDraft(BaseModel):
    """A persisted ``artifacts`` row (PRD §10.3), always ``status='draft'``.

    Carries the §18.3 audit trail: ``model_id`` + ``prompt_version`` + ``skill_versions``
    (skill_name → content_hash) record exactly what produced the draft. ``feature_id`` is
    optional because a release blog/changelog is release-level (it may span features).
    """

    model_config = _StrictModel

    artifact_id: str = Field(min_length=1)
    release_run_id: str = Field(min_length=1)
    feature_id: str | None = None
    artifact_type: str = Field(min_length=1)  # release_blog | changelog_entry
    title: str = Field(min_length=1)
    body_markdown: str = Field(min_length=1)
    status: str = "draft"
    model_id: str = Field(min_length=1)
    prompt_version: str = Field(min_length=1)
    # skill_name -> content_hash of the snapshot that fed this artifact's prompt.
    skill_versions: dict[str, str] = Field(default_factory=dict)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def content_hash(self) -> str:
        """T1 (spec 016) — the §18.3 tamper-evident artifact hash, derived from the content.

        A ``computed_field`` (not an input) so EVERY draft inherently carries a content hash and
        it can never drift from the title/body it describes: ``model_copy`` (used by the check
        nodes to flip ``status='blocked'``) recomputes it from the carried content, and the
        persist sink writes exactly this value. Same content → same hash (stable across retries),
        matching the dashboard's recompute on edit/approval and the SQL backfill."""
        return artifact_content_hash(self.title, self.body_markdown)


class SkillUsageEvent(BaseModel):
    """A ``skill_usage_events`` row (PRD §10.5): one skill snapshot used by one node for
    one artifact.

    This is the per-artifact record the AC requires ("each generated artifact records
    which skill snapshot versions/hashes were loaded"). ``skill_snapshot_id`` links back
    to the persisted ``skill_repo_snapshots`` row so the provenance is traceable (§9.2).
    """

    model_config = _StrictModel

    release_run_id: str = Field(min_length=1)
    artifact_id: str = Field(min_length=1)
    graph_name: str = Field(min_length=1)
    node_name: str = Field(min_length=1)
    skill_snapshot_id: str = Field(min_length=1)
    skill_name: str = Field(min_length=1)
    skill_version: str | None = None
    content_hash: str = Field(min_length=1)
    usage_type: str = Field(min_length=1)


class NoApprovedFeaturesError(ValueError):
    """Raised when content generation is reached with zero approved features.

    The graph refuses to proceed (AC: "with zero approved features the graph does not
    produce artifacts"); user-safe message, no run-specific data echoed.
    """

    def __init__(self) -> None:
        super().__init__(
            "no approved features for this run; content generation cannot proceed"
        )


class MalformedArtifactOutputError(ValueError):
    """Raised when Bedrock artifact output fails boundary validation.

    User-safe: never echoes the offending model output (built from feature text, could
    carry residual sensitive content), only that it was rejected (AC4 / §5).
    """

    def __init__(self) -> None:
        super().__init__("the model artifact output was malformed and was rejected")
