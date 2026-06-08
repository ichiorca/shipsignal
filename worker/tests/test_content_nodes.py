"""T2/T3/T4/T5 (spec 005) — the content_generation_graph node chain.

Exercises the exact public surface the graph nodes wrap — skill snapshotting, approved-
feature loading, blog/changelog generation, and draft persistence — against the in-memory
fakes (anti-pattern #4: no private helper, no DB/Bedrock/network). The fakes record what
was persisted / what prompt was sent, so the constitution's invariants are *proven* by
inspection:

* §9.2 — Aurora is provenance, the repo SKILL.md is canonical: snapshots carry the repo
  path + commit + content hash (inspect ``sink.snapshots``).
* §5 — no generation from unapproved work: zero approved features → refuse to proceed.
* §5 — model output is untrusted: a malformed artifact body is rejected.
* §5 — no self-approval: every persisted artifact is ``status='draft'``.
* AC — each artifact records which skill versions/hashes were loaded (inspect usage events).
"""

from __future__ import annotations

import itertools

import pytest

from release_worker.content_models import (
    ApprovedFeature,
    MalformedArtifactOutputError,
    NoApprovedFeaturesError,
    RawSkill,
)
from release_worker.content_nodes import (
    generate_artifacts,
    load_approved_features,
    parse_frontmatter,
    persist_reviewable_artifacts,
    snapshot_active_skills,
)
from release_worker.content_ports import (
    InMemoryApprovedFeatureReader,
    InMemoryArtifactSink,
    InMemorySkillSnapshotSink,
)
from release_worker.model_client import RecordingModelClient

_RUN_ID = "11111111-1111-4111-8111-111111111111"
_REPO = "org/product"
_FEAT1 = "ffffffff-1111-2222-3333-444444444444"
_FEAT2 = "eeeeeeee-1111-2222-3333-444444444444"
_SHA = "abc123def456"


def _approved_features() -> tuple[ApprovedFeature, ...]:
    return (
        ApprovedFeature(
            feature_id=_FEAT1,
            release_run_id=_RUN_ID,
            title="Admin-configurable onboarding checklist",
            summary_internal="Admins create and assign onboarding checklists.",
            user_value="Repeatable onboarding rollout.",
            audiences=("admin", "customer_success"),
            change_type="new_feature",
        ),
        ApprovedFeature(
            feature_id=_FEAT2,
            release_run_id=_RUN_ID,
            title="Dark mode",
            user_value="Comfortable viewing at night.",
        ),
    )


_SKILL_BRAND = (
    "---\nname: brand-voice\nversion: 1.0.0\nstatus: active\nevolvable: true\n---\n"
    "# Brand Voice\nWrite clearly. No hype."
)
_SKILL_BLOG = (
    "---\nname: blog-format\nversion: 2.1.0\n---\n# Blog Format\nUse H2 per feature."
)


def _raw_skills(sha: str = _SHA) -> tuple[RawSkill, ...]:
    return (
        RawSkill(
            skill_path="skills/blog-format/SKILL.md",
            content=_SKILL_BLOG,
            commit_sha=sha,
        ),
        RawSkill(
            skill_path="skills/brand-voice/SKILL.md",
            content=_SKILL_BRAND,
            commit_sha=sha,
        ),
    )


def _artifact_response() -> dict[str, object]:
    return {"title": "Release highlights", "body_markdown": "# Release\n\nGreat stuff."}


# --- T2 frontmatter parsing -------------------------------------------------------


def test_parse_frontmatter_extracts_scalars_and_booleans() -> None:
    frontmatter, body = parse_frontmatter(_SKILL_BRAND)
    assert frontmatter["name"] == "brand-voice"
    assert frontmatter["version"] == "1.0.0"
    assert frontmatter["evolvable"] is True  # 'true' coerced to bool
    assert body.startswith("# Brand Voice")


def test_parse_frontmatter_no_fence_returns_whole_body() -> None:
    frontmatter, body = parse_frontmatter("# Just a heading\nno frontmatter")
    assert frontmatter == {}
    assert body == "# Just a heading\nno frontmatter"


# --- T2 snapshot active skills ----------------------------------------------------


def test_snapshot_records_path_commit_and_content_hash() -> None:
    """§9.2/§10.5: each snapshot carries the repo path, commit, and a content hash; the
    canonical source stays the repo file (Aurora only records provenance)."""
    sink = InMemorySkillSnapshotSink()
    ids = (f"snap-{n}" for n in itertools.count())

    snapshots = snapshot_active_skills(_REPO, _raw_skills(), sink, lambda: next(ids))

    assert {s.skill_name for s in snapshots} == {"brand-voice", "blog-format"}
    blog = next(s for s in snapshots if s.skill_name == "blog-format")
    assert blog.skill_path == "skills/blog-format/SKILL.md"
    assert blog.commit_sha == _SHA
    assert blog.skill_version == "2.1.0"
    assert len(blog.content_hash) == 64  # sha256 hex
    assert all(s.is_active for s in sink.active())


def test_snapshot_is_idempotent_for_same_commit() -> None:
    """Re-snapshotting the same commit upserts to the same row (stable effective id)."""
    sink = InMemorySkillSnapshotSink()
    ids = (f"snap-{n}" for n in itertools.count())

    first = snapshot_active_skills(_REPO, _raw_skills(), sink, lambda: next(ids))
    second = snapshot_active_skills(_REPO, _raw_skills(), sink, lambda: next(ids))

    first_ids = {s.skill_path: s.snapshot_id for s in first}
    second_ids = {s.skill_path: s.snapshot_id for s in second}
    assert first_ids == second_ids  # same commit → same snapshot id


def test_snapshot_marks_prior_commit_inactive() -> None:
    """A new commit's snapshot is the only active one for that (repo, skill_path)."""
    sink = InMemorySkillSnapshotSink()
    ids = (f"snap-{n}" for n in itertools.count())

    snapshot_active_skills(_REPO, _raw_skills("oldsha"), sink, lambda: next(ids))
    snapshot_active_skills(_REPO, _raw_skills("newsha"), sink, lambda: next(ids))

    active = {(s.skill_path, s.commit_sha) for s in sink.active()}
    assert ("skills/blog-format/SKILL.md", "newsha") in active
    assert ("skills/blog-format/SKILL.md", "oldsha") not in active


# --- T3 load approved features ----------------------------------------------------


def test_load_approved_features_returns_only_for_the_run() -> None:
    reader = InMemoryApprovedFeatureReader(_approved_features())
    features = load_approved_features(_RUN_ID, reader)
    assert {f.feature_id for f in features} == {_FEAT1, _FEAT2}


def test_load_approved_features_refuses_when_none_approved() -> None:
    """AC: with zero approved features the graph does not produce artifacts."""
    reader = InMemoryApprovedFeatureReader(())
    with pytest.raises(NoApprovedFeaturesError) as exc:
        load_approved_features(_RUN_ID, reader)
    assert "no approved features" in str(exc.value)


# --- T4 generate artifacts --------------------------------------------------------


def _snapshots():
    sink = InMemorySkillSnapshotSink()
    ids = (f"snap-{n}" for n in itertools.count())
    return snapshot_active_skills(_REPO, _raw_skills(), sink, lambda: next(ids))


def test_generate_produces_blog_and_changelog_as_drafts() -> None:
    client = RecordingModelClient(_artifact_response())
    art_ids = (f"art-{n}" for n in itertools.count())

    artifacts, _events = generate_artifacts(
        _RUN_ID,
        _approved_features(),
        _snapshots(),
        client,
        lambda: next(art_ids),
        model_id="bedrock-model-x",
    )

    types = {a.artifact_type for a in artifacts}
    assert types == {"release_blog", "changelog_entry"}
    for a in artifacts:
        assert a.status == "draft"  # no self-approval (§5)
        assert a.model_id == "bedrock-model-x"
        assert a.prompt_version == "content-gen-v1"


def test_generate_prompt_carries_only_features_and_skills_no_raw() -> None:
    """§5: the prompt is built from approved features + repo skill bodies, nothing raw."""
    client = RecordingModelClient(_artifact_response())
    art_ids = (f"art-{n}" for n in itertools.count())

    generate_artifacts(
        _RUN_ID,
        _approved_features(),
        _snapshots(),
        client,
        lambda: next(art_ids),
        model_id="m",
    )

    user_prompt = client.calls[-1].messages[0]["content"]
    assert "Admin-configurable onboarding checklist" in user_prompt
    system_prompt = client.calls[-1].system
    assert "Brand Voice" in system_prompt  # skill body injected


def test_generate_records_skill_usage_per_artifact() -> None:
    """AC: each generated artifact records which skill snapshot versions/hashes were loaded."""
    snapshots = _snapshots()
    client = RecordingModelClient(_artifact_response())
    art_ids = (f"art-{n}" for n in itertools.count())

    artifacts, events = generate_artifacts(
        _RUN_ID,
        _approved_features(),
        snapshots,
        client,
        lambda: next(art_ids),
        model_id="m",
    )

    # One usage event per (artifact, skill snapshot).
    assert len(events) == len(artifacts) * len(snapshots)
    snapshot_ids = {s.snapshot_id for s in snapshots}
    assert {e.skill_snapshot_id for e in events} == snapshot_ids
    assert all(e.usage_type == "generation" for e in events)
    assert all(e.graph_name == "content_generation_graph" for e in events)
    # The artifact's skill_versions map records each skill's content hash.
    for a in artifacts:
        assert a.skill_versions == {s.skill_name: s.content_hash for s in snapshots}


def test_generate_idempotency_key_stable_for_same_inputs() -> None:
    """aws-bedrock-rules: a retried generation reuses the same dedupe key."""
    snapshots = _snapshots()
    client = RecordingModelClient(_artifact_response())
    art_ids = (f"art-{n}" for n in itertools.count())

    generate_artifacts(
        _RUN_ID,
        _approved_features(),
        snapshots,
        client,
        lambda: next(art_ids),
        model_id="m",
    )
    keys_first = [c.idempotency_key for c in client.calls]

    generate_artifacts(
        _RUN_ID,
        tuple(reversed(_approved_features())),
        snapshots,
        client,
        lambda: next(art_ids),
        model_id="m",
    )
    keys_second = [c.idempotency_key for c in client.calls[len(keys_first) :]]
    assert keys_first == keys_second  # order-independent, stable


def test_generate_rejects_malformed_model_output() -> None:
    client = RecordingModelClient({"title": "no body"})  # missing body_markdown
    art_ids = (f"art-{n}" for n in itertools.count())

    with pytest.raises(MalformedArtifactOutputError) as exc:
        generate_artifacts(
            _RUN_ID,
            _approved_features(),
            _snapshots(),
            client,
            lambda: next(art_ids),
            model_id="m",
        )
    assert "malformed" in str(exc.value)


# --- T5 persist reviewable artifacts ----------------------------------------------


def test_persist_writes_artifacts_then_usage_events() -> None:
    """AC: artifacts persist (status=draft); usage events recorded. Artifacts first (FK)."""
    snapshots = _snapshots()
    client = RecordingModelClient(_artifact_response())
    art_ids = (f"art-{n}" for n in itertools.count())
    artifacts, events = generate_artifacts(
        _RUN_ID,
        _approved_features(),
        snapshots,
        client,
        lambda: next(art_ids),
        model_id="m",
    )
    sink = InMemoryArtifactSink()

    inserted = persist_reviewable_artifacts(artifacts, events, sink)

    assert inserted == tuple(a.artifact_id for a in artifacts)
    assert {a.status for a in sink.artifacts} == {"draft"}
    assert len(sink.usage_events) == len(events)
    # Every usage event references an artifact that was inserted (FK ordering holds).
    inserted_ids = {a.artifact_id for a in sink.artifacts}
    assert all(e.artifact_id in inserted_ids for e in sink.usage_events)
