"""T2/T3/T4/T6 (spec 009) — the skill_learning_graph node chain.

Exercises the exact public surface the graph nodes wrap — signal mining, edit/rejection
clustering, impacted-skill selection, candidate drafting, persistence, the Gate #3 routing, and
the approve (repo write + promotion) / reject (suppression) branches — against the in-memory fakes
(anti-pattern #4: no private helper, no DB/Bedrock/repo write). The fakes record what was
persisted / written, so the constitution's invariants are *proven* by inspection:

* §5 / AC1 — no silent overwrite: the repo writer is touched ONLY by ``update_repo_skill_file``
  (the approved branch); drafting/persisting never writes a file.
* §5 — model output is untrusted: a malformed skill draft is rejected.
* AC2 — promotion records the commit sha + old/new content hashes (preserved on the row).
* §9.4.7 / AC3 — a suppressed near-duplicate is not re-drafted; a rejection opens the cooldown.
* §9.2 / AC4 — Aurora is a staging ledger: candidates persist ``status='draft'``; the canonical
  body is the rendered repo file the writer receives.
"""

from __future__ import annotations

import hashlib
import itertools

import pytest

from release_worker.content_nodes import parse_frontmatter
from release_worker.feature_models import GateDecision
from release_worker.model_client import RecordingModelClient
from release_worker.skill_learning_models import (
    ActiveSkill,
    ImpactedSkill,
    MalformedSkillDraftError,
    PromotionMode,
    RawReviewSignal,
    SkillGateResolution,
    SkillRevisionCandidate,
)
from release_worker.skill_learning_nodes import (
    build_gate3_payload,
    cluster_edit_patterns,
    cluster_rejection_patterns,
    collect_learning_signals,
    draft_skill_revision_candidate,
    mark_candidate_promoted,
    parse_skill_gate,
    persist_candidate_in_aurora,
    record_rejection_and_suppression,
    render_skill_file,
    route_after_gate3,
    select_impacted_skills,
    update_repo_skill_file,
)
from release_worker.skill_learning_ports import (
    InMemoryActiveSkillReader,
    InMemoryLearningSignalSink,
    InMemoryLearningSignalSource,
    InMemoryRepoSkillWriter,
    InMemorySkillCandidateSink,
    InMemorySuppressionStore,
)

_RUN_ID = "11111111-1111-4111-8111-111111111111"
_REPO = "org/product"
_SNAP_BV = "snap-brand-voice"
_SNAP_BLOG = "snap-blog-format"

_BRAND_VOICE_CONTENT = (
    "---\nname: brand-voice\nversion: 1.3.0\n---\n\nWrite with restraint."
)
_BLOG_FORMAT_CONTENT = (
    "---\nname: blog-format\nversion: 2.0.0\n---\n\nLead with the value."
)

_DRAFT_RESPONSE: dict[str, object] = {
    "proposed_body": "Write with restraint. Avoid hype and unsupported metrics.",
    "proposal_reason": "Reduce hype and remove unsupported metric language.",
}


def _raw_signals() -> tuple[RawReviewSignal, ...]:
    return (
        # An edit that removes a superlative → reduce_hype, attributed to brand-voice.
        RawReviewSignal(
            signal_type="reviewer_edit",
            artifact_id="art-1",
            source_text="This is the best feature ever.\nIt helps.",
            revised_text="This is a useful feature.\nIt helps.",
            reviewer="alice",
            related_skill_snapshot_ids=(_SNAP_BV,),
        ),
        # An edit that drops an unsupported metric → remove_unsupported_metric, brand-voice.
        RawReviewSignal(
            signal_type="reviewer_edit",
            artifact_id="art-1",
            source_text="Saves 50% of time.\nGreat.",
            revised_text="Saves time.\nGreat.",
            reviewer="alice",
            related_skill_snapshot_ids=(_SNAP_BV,),
        ),
        # A rejected claim → rejection cluster, attributed to blog-format.
        RawReviewSignal(
            signal_type="rejected_claim",
            artifact_id="art-2",
            source_text="It reduces onboarding time by 50%.",
            rejection_category="unsupported_metric",
            severity="high",
            related_skill_snapshot_ids=(_SNAP_BLOG,),
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
                content_hash="hash-bv",
            ),
            _SNAP_BLOG: ActiveSkill(
                snapshot_id=_SNAP_BLOG,
                repo=_REPO,
                skill_name="blog-format",
                skill_path="skills/blog-format/SKILL.md",
                skill_version="2.0.0",
                content=_BLOG_FORMAT_CONTENT,
                content_hash="hash-blog",
            ),
        }
    )


def _collect() -> tuple:
    """Run the collect node and return (signals, sink)."""
    source = InMemoryLearningSignalSource(_raw_signals())
    sink = InMemoryLearningSignalSink()
    counter = itertools.count(1)
    signals = collect_learning_signals(
        _RUN_ID, source, sink, lambda: f"sig-{next(counter)}"
    )
    return signals, sink


# --- T2 — collect ----------------------------------------------------------------


def test_collect_persists_signals_and_computes_edit_diff() -> None:
    signals, sink = _collect()
    assert len(signals) == 3
    # Every mined signal was persisted (AC: Aurora records edit diffs, rejected claims, notes).
    assert len(sink.signals) == 3
    edit = next(s for s in signals if s.signal_type == "reviewer_edit")
    # The line-level diff captured what the reviewer removed (the hype line).
    assert "This is the best feature ever." in edit.diff["removed"]
    assert "This is a useful feature." in edit.diff["added"]
    # A non-edit signal carries no diff.
    rejected = next(s for s in signals if s.signal_type == "rejected_claim")
    assert rejected.diff == {}
    assert rejected.related_skill_snapshot_ids == (_SNAP_BLOG,)


# --- T3 — clustering + impacted skills -------------------------------------------


def test_cluster_edit_patterns_groups_by_theme() -> None:
    signals, _ = _collect()
    clusters = cluster_edit_patterns(signals)
    themes = {c.theme for c in clusters}
    assert themes == {"reduce_hype", "remove_unsupported_metric"}
    for cluster in clusters:
        assert cluster.signal_type == "reviewer_edit"
        assert cluster.snapshot_ids == (_SNAP_BV,)


def test_cluster_rejection_patterns_groups_by_category() -> None:
    signals, _ = _collect()
    clusters = cluster_rejection_patterns(signals)
    assert len(clusters) == 1
    assert clusters[0].theme == "unsupported_metric"
    assert clusters[0].snapshot_ids == (_SNAP_BLOG,)


def test_select_impacted_skills_maps_clusters_to_active_skills() -> None:
    signals, _ = _collect()
    clusters = cluster_edit_patterns(signals) + cluster_rejection_patterns(signals)
    impacted = select_impacted_skills(clusters, _active_reader())
    by_name = {i.skill.skill_name: i for i in impacted}
    assert set(by_name) == {"brand-voice", "blog-format"}
    # brand-voice gathered both edit clusters; blog-format the rejection cluster.
    assert len(by_name["brand-voice"].clusters) == 2
    assert len(by_name["blog-format"].clusters) == 1


# --- T4 — draft + persist --------------------------------------------------------


def _impacted() -> tuple[ImpactedSkill, ...]:
    signals, _ = _collect()
    clusters = cluster_edit_patterns(signals) + cluster_rejection_patterns(signals)
    return select_impacted_skills(clusters, _active_reader())


def test_draft_produces_draft_candidates_with_bumped_version() -> None:
    impacted = _impacted()
    model = RecordingModelClient(_DRAFT_RESPONSE)
    suppressions = InMemorySuppressionStore()
    counter = itertools.count(1)
    candidates = draft_skill_revision_candidate(
        impacted, model, suppressions, lambda: f"cand-{next(counter)}"
    )
    assert len(candidates) == 2
    bv = next(c for c in candidates if c.skill_name == "brand-voice")
    assert bv.status == "draft"  # §5: never self-approved
    assert bv.proposed_version == "1.4.0"  # 1.3.0 bumped (PRD §9.5)
    assert bv.old_content_hash == "hash-bv"
    assert bv.base_skill_snapshot_id == _SNAP_BV
    assert 0.0 <= bv.confidence <= 0.95
    # The prompt carried only redacted/internal review text + the current body (no DB/secret).
    assert model.calls, "a draft model call was made"


def test_draft_skips_a_suppressed_near_duplicate() -> None:
    impacted = _impacted()
    model = RecordingModelClient(_DRAFT_RESPONSE)
    # First pass with no suppressions to learn brand-voice's pattern_hash.
    first = draft_skill_revision_candidate(
        impacted, model, InMemorySuppressionStore(), lambda: "cand-x"
    )
    bv = next(c for c in first if c.skill_name == "brand-voice")

    # Seed a suppression for that exact (repo, skill, pattern) and re-draft.
    suppressions = InMemorySuppressionStore({(_REPO, "brand-voice", bv.pattern_hash)})
    counter = itertools.count(1)
    second = draft_skill_revision_candidate(
        impacted, model, suppressions, lambda: f"cand-{next(counter)}"
    )
    # brand-voice is suppressed (AC3); only blog-format is re-proposed.
    assert {c.skill_name for c in second} == {"blog-format"}


def test_draft_rejects_malformed_model_output() -> None:
    impacted = _impacted()
    model = RecordingModelClient({"unexpected": "shape"})
    with pytest.raises(MalformedSkillDraftError):
        draft_skill_revision_candidate(
            impacted, model, InMemorySuppressionStore(), lambda: "cand-1"
        )


def test_persist_writes_drafts_only() -> None:
    impacted = _impacted()
    candidates = draft_skill_revision_candidate(
        impacted,
        RecordingModelClient(_DRAFT_RESPONSE),
        InMemorySuppressionStore(),
        lambda: "cand-1",
    )
    sink = InMemorySkillCandidateSink()
    persist_candidate_in_aurora(candidates, sink)
    assert len(sink.candidates) == len(candidates)
    assert all(c.status == "draft" for c in sink.candidates)
    # Persisting never promotes or rejects (no repo write either).
    assert sink.promotions == []
    assert sink.rejections == []


# --- T5 — gate payload + routing -------------------------------------------------


def test_build_gate3_payload_targets_the_skill_review_url() -> None:
    candidates = _drafted()
    payload = build_gate3_payload(
        _RUN_ID, "lg_1", candidates, "https://app.example.com/"
    )
    assert payload.gate == "skill_candidate_approval"
    assert payload.candidates_pending_review == len(candidates)
    assert (
        payload.dashboard_url
        == f"https://app.example.com/releases/{_RUN_ID}/skills/review"
    )


def test_parse_skill_gate_accepts_string_and_object_and_rejects_garbage() -> None:
    assert parse_skill_gate("approved").decision == "approved"
    resolved = parse_skill_gate({"decision": "rejected", "reviewer": "bob"})
    assert resolved.decision == "rejected"
    assert resolved.reviewer == "bob"
    with pytest.raises(ValueError):
        parse_skill_gate("definitely-not-a-decision")


def test_route_after_gate3() -> None:
    approved = SkillGateResolution(decision=GateDecision.APPROVED.value)
    rejected = SkillGateResolution(decision=GateDecision.REJECTED.value)
    assert route_after_gate3(approved) == "update_repo_skill_file"
    assert route_after_gate3(rejected) == "record_rejection_and_suppression"


# --- T6 — approve (repo write + promotion) | reject (suppression) ----------------


def _drafted() -> tuple[SkillRevisionCandidate, ...]:
    return draft_skill_revision_candidate(
        _impacted(),
        RecordingModelClient(_DRAFT_RESPONSE),
        InMemorySuppressionStore(),
        lambda: "cand-1",
    )


def test_approve_writes_only_the_skill_path_and_records_promotion() -> None:
    candidates = (_drafted()[0],)
    writer = InMemoryRepoSkillWriter(commit_sha="abc123sha")
    resolution = SkillGateResolution(decision="approved", reviewer="carol")

    records = update_repo_skill_file(candidates, resolution, writer)
    # The single repo write: exactly the candidate's skill_path, with rendered frontmatter+body.
    assert len(writer.written) == 1
    written_path, written_content = writer.written[0]
    assert written_path == candidates[0].skill_path
    frontmatter, _ = parse_frontmatter(written_content)
    assert frontmatter["version"] == candidates[0].proposed_version

    # AC2 — the promotion record carries the commit sha + old/new content hashes.
    assert len(records) == 1
    record = records[0]
    assert record.promoted_commit_sha == "abc123sha"
    assert record.old_content_hash == candidates[0].old_content_hash
    expected_new = hashlib.sha256(written_content.encode("utf-8")).hexdigest()
    assert record.new_content_hash == expected_new
    assert record.reviewer == "carol"

    sink = InMemorySkillCandidateSink()
    mark_candidate_promoted(records, sink)
    assert sink.promotions == list(records)


def test_approve_stamps_last_promoted_candidate_id_in_frontmatter() -> None:
    # T2 (spec 018) — the promoted SKILL.md records WHICH candidate produced it (PRD §9.1).
    candidate = _drafted()[0]
    writer = InMemoryRepoSkillWriter(commit_sha="abc123sha")
    resolution = SkillGateResolution(decision="approved", reviewer="carol")

    update_repo_skill_file((candidate,), resolution, writer)

    _, written_content = writer.written[0]
    frontmatter, _ = parse_frontmatter(written_content)
    # Stamped at promotion (only the promoted candidate is known then), not at draft time.
    assert frontmatter["last_promoted_candidate_id"] == candidate.candidate_id
    # The proposed frontmatter (e.g. the bumped version) is preserved alongside the stamp.
    assert frontmatter["version"] == candidate.proposed_version


def test_approve_via_pr_mode_records_pr_provenance() -> None:
    # T3 (spec 018) — a PR-mode writer's promotion_mode + pr_url flow onto the PromotionRecord
    # (PRD §15.3), so Aurora records HOW the skill was promoted.
    candidate = _drafted()[0]
    writer = InMemoryRepoSkillWriter(
        commit_sha="prcommitsha",
        promotion_mode=PromotionMode.PR,
        pr_url="https://github.com/org/product/pull/7",
    )
    resolution = SkillGateResolution(decision="approved", reviewer="carol")

    records = update_repo_skill_file((candidate,), resolution, writer)

    assert records[0].promotion_mode is PromotionMode.PR
    assert records[0].pr_url == "https://github.com/org/product/pull/7"
    assert records[0].promoted_commit_sha == "prcommitsha"


def test_approve_direct_mode_records_no_pr_url() -> None:
    # The direct (hackathon-fast) write records mode='direct' and no PR url — the selectable fallback.
    candidate = _drafted()[0]
    writer = InMemoryRepoSkillWriter(commit_sha="abc123sha")
    resolution = SkillGateResolution(decision="approved", reviewer="carol")

    records = update_repo_skill_file((candidate,), resolution, writer)

    assert records[0].promotion_mode is PromotionMode.DIRECT
    assert records[0].pr_url is None


def test_reject_records_rejection_and_opens_cooldown_but_writes_no_file() -> None:
    candidate = _drafted()[0]
    sink = InMemorySkillCandidateSink()
    suppressions = InMemorySuppressionStore()
    resolution = SkillGateResolution(decision="rejected", reviewer="dave")

    record_rejection_and_suppression((candidate,), resolution, sink, suppressions)
    # The rejection is recorded with its reason (§9.4.6); no promotion, no repo write.
    assert len(sink.rejections) == 1
    assert sink.promotions == []
    # A cooldown suppression was opened on the candidate's pattern (§9.4.7 / AC3).
    assert suppressions.is_suppressed(
        _REPO, candidate.skill_name, candidate.pattern_hash
    )
    assert len(suppressions.added) == 1


def test_request_changes_records_review_without_suppression() -> None:
    candidate = _drafted()[0]
    sink = InMemorySkillCandidateSink()
    suppressions = InMemorySuppressionStore()
    resolution = SkillGateResolution(decision="edited", reviewer="erin")

    record_rejection_and_suppression((candidate,), resolution, sink, suppressions)
    # A request-changes keeps the candidate open: recorded, but NOT suppressed.
    assert len(sink.rejections) == 1
    assert suppressions.added == []
    assert not suppressions.is_suppressed(
        _REPO, candidate.skill_name, candidate.pattern_hash
    )


def test_render_skill_file_round_trips_through_parse_frontmatter() -> None:
    frontmatter: dict[str, str | bool] = {"name": "brand-voice", "version": "1.4.0"}
    rendered = render_skill_file(frontmatter, "Body text here.")
    parsed_fm, parsed_body = parse_frontmatter(rendered)
    assert parsed_fm["name"] == "brand-voice"
    assert parsed_fm["version"] == "1.4.0"
    assert parsed_body == "Body text here."
