"""T2-T6 (spec 009) — the ports ``skill_learning_graph`` depends on, plus in-memory fakes.

P4 (Storage) + P1 (Substrate): the nodes never import psycopg/boto3/pathlib-writes directly —
they depend on these narrow Protocols. The durable implementations live in runtime-only modules
(``aurora_skill_learning``, ``repo_skill_writer``) imported by ``__main__``, so the unit gate
exercises the pure node logic against the fakes here — no DB, no Bedrock, no repo write.

constitution §5 / §9.4 — the blast-radius rules are encoded in the ports:

* ``RepoSkillWriter`` is the ONLY thing that writes a repo file, and the graph reaches it only on
  the approved branch of the Gate #3 interrupt. ``SkillCandidateSink`` persists candidates
  ``status='draft'`` and only records a promotion/rejection from a recorded human decision.
* ``SuppressionStore`` enforces the cooldown so a near-duplicate of a rejected candidate is not
  re-proposed (§9.4.7). ``ActiveSkillReader`` resolves the current repo skill (the canonical
  source, §9.2) that a proposal is diffed against.
"""

from __future__ import annotations

import hashlib
from typing import Protocol, runtime_checkable

from release_worker.skill_learning_models import (
    ActiveSkill,
    LearningSignal,
    PromotionRecord,
    PromotionResult,
    SkillRevisionCandidate,
)


class NoActiveSkillError(ValueError):
    """Raised when a referenced skill snapshot resolves to no active repo skill.

    The graph fails closed (it drafts nothing for that skill) rather than diffing against a
    missing base. User-safe: echoes no run-specific data."""

    def __init__(self) -> None:
        super().__init__("no active repo skill for the referenced snapshot")


@runtime_checkable
class LearningSignalSource(Protocol):
    """Surface a run's recorded Gate #1/#2 review actions as raw signals (PRD §9.3 step 4).

    Reads the approvals/rejections/edits already in Aurora for the run and yields one record per
    reviewer action. ``AuroraLearningSignalSource`` satisfies it at runtime."""

    def collect_review_signals(self, release_run_id: str) -> tuple[object, ...]: ...


@runtime_checkable
class LearningSignalSink(Protocol):
    """Persist mined ``learning_signals`` rows (PRD §10.5). ``AuroraLearningSignalSink`` at runtime."""

    def insert_signal(self, signal: LearningSignal) -> None: ...


@runtime_checkable
class ActiveSkillReader(Protocol):
    """Resolve referenced skill snapshots to their current active repo skills (PRD §5.5).

    Returns one ``ActiveSkill`` per distinct skill the snapshot ids reference, carrying the FULL
    current SKILL.md body read from the checked-out repo (the canonical source, §9.2) plus the
    active snapshot id + content hash the proposal is diffed against. ``AuroraRepoActiveSkillReader``
    satisfies it at runtime."""

    def active_skills_for_snapshots(
        self, snapshot_ids: tuple[str, ...]
    ) -> tuple[ActiveSkill, ...]: ...


@runtime_checkable
class SuppressionStore(Protocol):
    """The cooldown gate for near-duplicate rejected candidates (PRD §9.4.7 / §10.5).

    ``is_suppressed`` returns True while an ACTIVE suppression window exists for
    (repo, skill_name, pattern_hash); ``add_suppression`` opens a window of ``cooldown_days``
    against a rejected candidate. ``AuroraSuppressionStore`` satisfies it at runtime."""

    def is_suppressed(self, repo: str, skill_name: str, pattern_hash: str) -> bool: ...

    def add_suppression(
        self,
        repo: str,
        skill_name: str,
        pattern_hash: str,
        rejected_candidate_id: str,
        reason: str,
        cooldown_days: int,
    ) -> None: ...


@runtime_checkable
class SkillCandidateSink(Protocol):
    """Persist staged candidates + record their Gate #3 outcome (PRD §10.5).

    ``insert_candidate`` writes a ``status='draft'`` proposal; ``mark_promoted`` records the
    approved replacement's commit sha + old/new hashes (preserved after replacement, AC2);
    ``record_rejection`` records a rejected/changes-requested decision with its reason.
    ``AuroraSkillCandidateSink`` satisfies it at runtime."""

    def insert_candidate(self, candidate: SkillRevisionCandidate) -> None: ...

    def mark_promoted(self, record: PromotionRecord) -> None: ...

    def record_rejection(
        self, candidate_id: str, decision: str, reviewer: str | None, reason: str
    ) -> None: ...


@runtime_checkable
class RepoSkillWriter(Protocol):
    """Replace ONE repo ``SKILL.md`` with an approved body — the single repo write (PRD §9.4).

    constitution §5 (blast radius): the only file the system overwrites is the approved
    ``skills/**/SKILL.md``, and only after Gate #3. Returns the resulting commit sha +
    new content hash. ``FilesystemRepoSkillWriter`` satisfies it at runtime; the unit gate uses
    ``InMemoryRepoSkillWriter`` so no test ever touches the working tree."""

    def replace_skill_file(
        self, skill_path: str, file_content: str
    ) -> PromotionResult: ...


# --- in-memory fakes (the unit gate; no DB / Bedrock / repo write) --------------------------


class InMemoryLearningSignalSource:
    """In-process ``LearningSignalSource``: returns the raw signals it was seeded with."""

    def __init__(self, signals: tuple[object, ...]) -> None:
        self._signals = signals

    def collect_review_signals(self, release_run_id: str) -> tuple[object, ...]:
        return self._signals


class InMemoryLearningSignalSink:
    """In-process ``LearningSignalSink``: records inserted signals (in write order) so a test can
    assert what was mined + persisted."""

    def __init__(self) -> None:
        self.signals: list[LearningSignal] = []

    def insert_signal(self, signal: LearningSignal) -> None:
        self.signals.append(signal)


class InMemoryActiveSkillReader:
    """In-process ``ActiveSkillReader``: maps each seeded snapshot id to its active skill and
    returns the distinct active skills for the requested ids (deduped by skill_path)."""

    def __init__(self, by_snapshot: dict[str, ActiveSkill]) -> None:
        self._by_snapshot = by_snapshot

    def active_skills_for_snapshots(
        self, snapshot_ids: tuple[str, ...]
    ) -> tuple[ActiveSkill, ...]:
        seen: dict[str, ActiveSkill] = {}
        for sid in snapshot_ids:
            skill = self._by_snapshot.get(sid)
            if skill is not None and skill.skill_path not in seen:
                seen[skill.skill_path] = skill
        return tuple(seen.values())


class InMemorySuppressionStore:
    """In-process ``SuppressionStore``: holds active (repo, skill_name, pattern_hash) keys so a
    test can prove a re-proposed near-duplicate is suppressed and that a rejection opens a window."""

    def __init__(self, suppressed: set[tuple[str, str, str]] | None = None) -> None:
        self._suppressed: set[tuple[str, str, str]] = set(suppressed or set())
        # One record per add_suppression call, for test introspection.
        self.added: list[tuple[str, str, str, str, str, int]] = []

    def is_suppressed(self, repo: str, skill_name: str, pattern_hash: str) -> bool:
        return (repo, skill_name, pattern_hash) in self._suppressed

    def add_suppression(
        self,
        repo: str,
        skill_name: str,
        pattern_hash: str,
        rejected_candidate_id: str,
        reason: str,
        cooldown_days: int,
    ) -> None:
        self._suppressed.add((repo, skill_name, pattern_hash))
        self.added.append(
            (
                repo,
                skill_name,
                pattern_hash,
                rejected_candidate_id,
                reason,
                cooldown_days,
            )
        )


class InMemorySkillCandidateSink:
    """In-process ``SkillCandidateSink``: records inserted drafts, promotions, and rejections so a
    test can assert candidates persist as drafts, the approved path records the promotion
    provenance, and the rejected path records the rejection (never a promotion)."""

    def __init__(self) -> None:
        self.candidates: list[SkillRevisionCandidate] = []
        self.promotions: list[PromotionRecord] = []
        self.rejections: list[tuple[str, str, str | None, str]] = []

    def insert_candidate(self, candidate: SkillRevisionCandidate) -> None:
        self.candidates.append(candidate)

    def mark_promoted(self, record: PromotionRecord) -> None:
        self.promotions.append(record)

    def record_rejection(
        self, candidate_id: str, decision: str, reviewer: str | None, reason: str
    ) -> None:
        self.rejections.append((candidate_id, decision, reviewer, reason))


class InMemoryRepoSkillWriter:
    """In-process ``RepoSkillWriter``: records the (skill_path, file_content) it was asked to write
    (so a test can prove ONLY the approved path is written, and only on the approved branch) and
    returns a deterministic promotion result. NEVER touches the working tree."""

    def __init__(self, commit_sha: str = "deadbeefcafebabe") -> None:
        self._commit_sha = commit_sha
        self.written: list[tuple[str, str]] = []

    def replace_skill_file(self, skill_path: str, file_content: str) -> PromotionResult:
        self.written.append((skill_path, file_content))
        new_hash = hashlib.sha256(file_content.encode("utf-8")).hexdigest()
        return PromotionResult(commit_sha=self._commit_sha, new_content_hash=new_hash)
