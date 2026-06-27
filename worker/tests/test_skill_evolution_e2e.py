"""End-to-end skill-evolution test (spec 009) — the WHOLE skill-learning loop through the COMPILED
graph, mimicking a real self-learning cycle without Bedrock.

Unlike ``test_skill_learning_nodes`` (which drives each node function in isolation), this builds the
real ``build_skill_learning_graph`` with a ``MemorySaver`` checkpointer and drives it the way the
runtime does: an initial invoke that mines reviewer feedback → clusters it → drafts a skill-revision
*suggestion* via the offline ``DemoModelClient`` → persists it ``status='draft'`` → HALTS at Gate #3
(no self-approval, §5); then a resumed invoke carrying the human decision that either promotes (the
repo write + next-version publish + commit-sha/provenance record) or rejects (cooldown, no write).

The offline ``DemoModelClient`` produces a *real, reviewable diff* of the current SKILL.md body
(softens hype, drops unsupported-metric phrasing, appends reviewer-informed guidance), so the
suggestion this generates is representative of what live Bedrock would draft. Flip in the Bedrock
client (zero code change) and the same graph runs live.

Proven invariants:
* §5 — Gate #3 halts before any repo write; the writer is untouched until 'approved'.
* AC2 — approval publishes the NEXT version: the writer receives the rendered file (bumped version),
  and the promotion record carries the commit sha + old/new content hashes.
* §9.4.7 / AC3 — a rejection opens a cooldown; a re-run with the same feedback shape is NOT redrafted.
"""

from __future__ import annotations

import pytest

from release_worker.claim_ports import InMemoryGuardrailScanner
from release_worker.content_nodes import parse_frontmatter
from release_worker.demo_model_client import DemoModelClient
from release_worker.skill_learning_models import ActiveSkill, RawReviewSignal
from release_worker.skill_learning_nodes import render_skill_file
from release_worker.skill_learning_ports import (
    InMemoryActiveSkillReader,
    InMemoryLearningSignalSink,
    InMemoryLearningSignalSource,
    InMemoryRepoSkillWriter,
    InMemorySkillCandidateSink,
    InMemorySuppressionStore,
)
from release_worker.skill_learning_state import SkillLearningState

_RUN_ID = "22222222-2222-4222-8222-222222222222"
_THREAD_ID = "lg_22222222_skill_learning"
_REPO = "org/product"
_DASHBOARD = "https://dash.example.com"
_COMMIT = "feedcafedeadbeef0123456789abcdef01234567"
_SNAP_BV = "snap-brand-voice"

# A current skill body carrying hype + an unsupported metric — exactly what reviewer feedback edits.
_BRAND_VOICE_CONTENT = (
    "---\nname: brand-voice\nversion: 1.3.0\n---\n\n"
    "Write with restraint. This is the best ever guidance and it delivers seamless results, "
    "saving 50% of onboarding time."
)


def _raw_signals() -> tuple[RawReviewSignal, ...]:
    return (
        RawReviewSignal(
            signal_type="reviewer_edit",
            artifact_id="art-1",
            source_text="This is the best feature ever.\nIt helps.",
            revised_text="This is a useful feature.\nIt helps.",
            reviewer="alice",
            related_skill_snapshot_ids=(_SNAP_BV,),
        ),
        RawReviewSignal(
            signal_type="reviewer_edit",
            artifact_id="art-1",
            source_text="Saves 50% of time.\nGreat.",
            revised_text="Saves time.\nGreat.",
            reviewer="alice",
            related_skill_snapshot_ids=(_SNAP_BV,),
        ),
        RawReviewSignal(
            signal_type="rejected_claim",
            artifact_id="art-2",
            source_text="It reduces onboarding time by 50%.",
            rejection_category="unsupported_metric",
            severity="high",
            related_skill_snapshot_ids=(_SNAP_BV,),
        ),
    )


def _active_reader() -> InMemoryActiveSkillReader:
    return InMemoryActiveSkillReader(
        {
            _SNAP_BV: ActiveSkill(
                snapshot_id=_SNAP_BV,
                repo=_REPO,
                skill_name="brand-voice",
                skill_path="skills/brand-voice/SKILL.md",
                skill_version="1.3.0",
                content=_BRAND_VOICE_CONTENT,
                content_hash="hash-bv-1.3.0",
            ),
        }
    )


def _build(
    *,
    candidate_sink: InMemorySkillCandidateSink,
    repo_writer: InMemoryRepoSkillWriter,
    suppressions: InMemorySuppressionStore,
):
    from langgraph.checkpoint.memory import MemorySaver

    from release_worker.skill_learning_graph import build_skill_learning_graph

    return build_skill_learning_graph(
        InMemoryLearningSignalSource(_raw_signals()),
        InMemoryLearningSignalSink(),
        _active_reader(),
        DemoModelClient(),
        suppressions,
        candidate_sink,
        repo_writer,
        InMemoryGuardrailScanner(),
        dashboard_base_url=_DASHBOARD,
        checkpointer=MemorySaver(),
    )


def test_generates_suggestion_halts_at_gate3_then_promotes_next_version() -> None:
    pytest.importorskip("langgraph")
    from langgraph.types import Command

    candidate_sink = InMemorySkillCandidateSink()
    repo_writer = InMemoryRepoSkillWriter(commit_sha=_COMMIT)
    suppressions = InMemorySuppressionStore()
    graph = _build(
        candidate_sink=candidate_sink,
        repo_writer=repo_writer,
        suppressions=suppressions,
    )
    config = {"configurable": {"thread_id": _THREAD_ID}}

    # 1) Initial run mines feedback → drafts a suggestion → HALTS at Gate #3 (no write yet, §5).
    result = graph.invoke(
        SkillLearningState(release_run_id=_RUN_ID, thread_id=_THREAD_ID, repo=_REPO),
        config,
    )
    assert "__interrupt__" in result
    payload = result["__interrupt__"][0].value
    assert payload["gate"] == "skill_candidate_approval"
    assert payload["candidates_pending_review"] == len(candidate_sink.candidates)

    # A real, reviewable suggestion was generated and staged as a draft — never auto-applied.
    assert len(candidate_sink.candidates) == 1
    candidate = candidate_sink.candidates[0]
    assert candidate.status == "draft"
    assert candidate.skill_name == "brand-voice"
    assert candidate.proposed_version == "1.4.0"  # minor bump from 1.3.0
    # The suggestion is a genuine revision of the current body: hype softened, guidance added.
    assert candidate.proposed_body != _BRAND_VOICE_CONTENT
    assert "Reviewer-informed revisions" in candidate.proposed_body
    assert "best ever" not in candidate.proposed_body
    assert "seamless" not in candidate.proposed_body
    assert candidate.proposal_reason
    # §5: nothing written to the repo while pending review.
    assert repo_writer.written == []
    assert candidate_sink.promotions == []

    # 2) Human promotes the suggestion → publishes the NEXT version (the single repo write).
    graph.invoke(Command(resume={"decision": "approved", "reviewer": "alice"}), config)

    # Exactly one repo write, to the candidate's skill path, with the rendered next-version file.
    assert len(repo_writer.written) == 1
    written_path, written_content = repo_writer.written[0]
    assert written_path == "skills/brand-voice/SKILL.md"
    expected_frontmatter = {
        **parse_frontmatter(_BRAND_VOICE_CONTENT)[0],
        "version": "1.4.0",
        "last_promoted_candidate_id": candidate.candidate_id,
    }
    assert written_content == render_skill_file(
        expected_frontmatter, candidate.proposed_body
    )
    # The published body carries the bumped version and the de-hyped guidance.
    assert "version: 1.4.0" in written_content
    assert "best ever" not in written_content

    # Promotion provenance recorded: commit sha + old/new content hashes + reviewer (AC2).
    assert len(candidate_sink.promotions) == 1
    record = candidate_sink.promotions[0]
    assert record.candidate_id == candidate.candidate_id
    assert record.promoted_commit_sha == _COMMIT
    assert record.old_content_hash == "hash-bv-1.3.0"
    assert record.new_content_hash and record.new_content_hash != "hash-bv-1.3.0"
    assert record.reviewer == "alice"


def test_reject_opens_cooldown_and_writes_no_repo_file() -> None:
    pytest.importorskip("langgraph")
    from langgraph.types import Command

    candidate_sink = InMemorySkillCandidateSink()
    repo_writer = InMemoryRepoSkillWriter(commit_sha=_COMMIT)
    suppressions = InMemorySuppressionStore()
    graph = _build(
        candidate_sink=candidate_sink,
        repo_writer=repo_writer,
        suppressions=suppressions,
    )
    config = {"configurable": {"thread_id": _THREAD_ID}}

    graph.invoke(
        SkillLearningState(release_run_id=_RUN_ID, thread_id=_THREAD_ID, repo=_REPO),
        config,
    )
    assert len(candidate_sink.candidates) == 1

    # Human rejects → no repo write, candidate recorded rejected, cooldown opened (§9.4.7).
    graph.invoke(Command(resume={"decision": "rejected", "reviewer": "bob"}), config)
    assert repo_writer.written == []
    assert candidate_sink.promotions == []
    assert candidate_sink.rejections
    assert suppressions.added, "a rejection must open a cooldown window"


def test_suppressed_duplicate_is_not_redrafted_after_rejection() -> None:
    pytest.importorskip("langgraph")
    from langgraph.types import Command

    candidate_sink = InMemorySkillCandidateSink()
    repo_writer = InMemoryRepoSkillWriter(commit_sha=_COMMIT)
    suppressions = InMemorySuppressionStore()

    # Run 1: generate → reject → cooldown is opened for this skill's feedback shape.
    graph1 = _build(
        candidate_sink=candidate_sink,
        repo_writer=repo_writer,
        suppressions=suppressions,
    )
    config1 = {"configurable": {"thread_id": _THREAD_ID + "-a"}}
    graph1.invoke(
        SkillLearningState(
            release_run_id=_RUN_ID, thread_id=_THREAD_ID + "-a", repo=_REPO
        ),
        config1,
    )
    graph1.invoke(Command(resume={"decision": "rejected", "reviewer": "bob"}), config1)
    drafted_after_run1 = len(candidate_sink.candidates)
    assert drafted_after_run1 == 1

    # Run 2: same feedback shape while the cooldown is active → NO new suggestion is drafted (AC3).
    graph2 = _build(
        candidate_sink=candidate_sink,
        repo_writer=repo_writer,
        suppressions=suppressions,
    )
    config2 = {"configurable": {"thread_id": _THREAD_ID + "-b"}}
    graph2.invoke(
        SkillLearningState(
            release_run_id=_RUN_ID, thread_id=_THREAD_ID + "-b", repo=_REPO
        ),
        config2,
    )
    assert len(candidate_sink.candidates) == drafted_after_run1  # nothing new drafted
