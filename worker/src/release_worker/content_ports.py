"""T2/T3/T5 (spec 005) — the ports the content-generation nodes persist/read through,
plus in-memory fakes for the unit gate.

P4 (Storage): the nodes never import psycopg/boto3 directly; they depend on these narrow
Protocols. The durable implementations live in runtime-only modules
(``aurora_content``, ``repo_skill_source``) imported by ``__main__``, so the unit gate
exercises the node logic against the fakes here without a DB, S3, or Bedrock — mirroring
the evidence/feature slices.

constitution §5 / §9.2: the readers surface only redacted, approved data (approved
features built from redacted evidence; skill bodies are repo-authored, non-PII). The sinks
write the §10.3/§10.5 provenance the audit trail depends on.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from release_worker.content_models import (
    ApprovedFeature,
    ArtifactDraft,
    RawSkill,
    SkillSnapshot,
    SkillUsageEvent,
)


@runtime_checkable
class ApprovedFeatureReader(Protocol):
    """Load a run's Gate#1-approved features for generation (PRD §5.3 load_approved_features).

    MUST return only ``status='approved'`` features so rejected/edited ones never flow
    downstream (constitution §5). ``AuroraApprovedFeatureReader`` satisfies it at runtime."""

    def list_approved_features(
        self, release_run_id: str
    ) -> tuple[ApprovedFeature, ...]: ...


@runtime_checkable
class SkillSource(Protocol):
    """Read the canonical ``skills/**/SKILL.md`` files from the checked-out repo (§9.1).

    The repo is the source of truth (§9.2); this just lists what is on disk at the run's
    commit. ``FilesystemSkillSource`` satisfies it at runtime."""

    def list_skills(self) -> tuple[RawSkill, ...]: ...


@runtime_checkable
class SkillSnapshotSink(Protocol):
    """Upsert a ``skill_repo_snapshots`` row and return its effective id (PRD §10.5).

    The upsert is idempotent on (repo, skill_path, commit_sha): re-snapshotting the same
    commit returns the existing row's id. The implementation also marks prior snapshots of
    the same skill_path inactive so exactly one snapshot is active per (repo, skill_path)."""

    def upsert_snapshot(self, record: SkillSnapshot) -> str: ...


@runtime_checkable
class ArtifactSink(Protocol):
    """Persist generated drafts and their skill-usage provenance (PRD §10.3/§10.5).

    Artifacts MUST be inserted before their usage events (the events FK-reference the
    artifact). ``AuroraArtifactSink`` satisfies it at runtime."""

    def insert_artifact(self, record: ArtifactDraft) -> None: ...

    def record_skill_usage(self, event: SkillUsageEvent) -> None: ...


class InMemoryApprovedFeatureReader:
    """In-process ``ApprovedFeatureReader``: returns the features it was seeded with so a
    test can drive both the populated and the zero-approved (refuse-to-proceed) paths."""

    def __init__(self, features: tuple[ApprovedFeature, ...]) -> None:
        self._features = features

    def list_approved_features(
        self, release_run_id: str
    ) -> tuple[ApprovedFeature, ...]:
        return tuple(f for f in self._features if f.release_run_id == release_run_id)


class InMemorySkillSource:
    """In-process ``SkillSource`` returning preset ``RawSkill`` files."""

    def __init__(self, skills: tuple[RawSkill, ...]) -> None:
        self._skills = skills

    def list_skills(self) -> tuple[RawSkill, ...]:
        return self._skills


class InMemorySkillSnapshotSink:
    """In-process ``SkillSnapshotSink``: records upserts and applies the same
    one-active-per-(repo, skill_path) rule the Aurora sink enforces, so a test can assert
    the active snapshot set and that re-upserting a commit is idempotent."""

    def __init__(self) -> None:
        # snapshot_id -> SkillSnapshot, with is_active reflecting the latest write.
        self.snapshots: dict[str, SkillSnapshot] = {}
        # (repo, skill_path, commit_sha) -> snapshot_id, for idempotent upsert.
        self._by_key: dict[tuple[str, str, str], str] = {}

    def upsert_snapshot(self, record: SkillSnapshot) -> str:
        key = (record.repo, record.skill_path, record.commit_sha)
        snapshot_id = self._by_key.get(key, record.snapshot_id)
        self._by_key[key] = snapshot_id
        # Deactivate other commits of the same skill (one active per repo+path).
        for sid, snap in self.snapshots.items():
            if (
                snap.repo == record.repo
                and snap.skill_path == record.skill_path
                and snap.commit_sha != record.commit_sha
            ):
                self.snapshots[sid] = snap.model_copy(update={"is_active": False})
        self.snapshots[snapshot_id] = record.model_copy(
            update={"snapshot_id": snapshot_id, "is_active": True}
        )
        return snapshot_id

    def active(self) -> list[SkillSnapshot]:
        return [s for s in self.snapshots.values() if s.is_active]


class InMemoryArtifactSink:
    """In-process ``ArtifactSink``: records inserted drafts and usage events (in write
    order) so a test can assert artifacts persist as drafts and that each usage event was
    recorded after its artifact (the FK ordering invariant)."""

    def __init__(self) -> None:
        self.artifacts: list[ArtifactDraft] = []
        self.usage_events: list[SkillUsageEvent] = []

    def insert_artifact(self, record: ArtifactDraft) -> None:
        self.artifacts.append(record)

    def record_skill_usage(self, event: SkillUsageEvent) -> None:
        self.usage_events.append(event)
