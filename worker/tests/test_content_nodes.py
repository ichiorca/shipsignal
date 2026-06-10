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
from pydantic import ValidationError

from release_worker.content_models import (
    ARTIFACT_TYPES,
    ApprovedFeature,
    ArtifactTypeSelection,
    MalformedArtifactOutputError,
    NoApprovedFeaturesError,
    RawSkill,
)
from release_worker.content_nodes import (
    generate_artifacts_parallel,
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


def _format_skill(name: str) -> str:
    return f"---\nname: {name}\nversion: 1.0.0\n---\n# {name}\nGuidance for {name}."


def _raw_skills(sha: str = _SHA) -> tuple[RawSkill, ...]:
    # One format skill per initial artifact type (spec 007 T2) + the shared brand-voice,
    # so every type's per-type selection resolves to exactly {its format skill, brand-voice}.
    format_names = (
        "blog-format",
        "changelog-format",
        "sales-onepager-format",
        "social-post-format",
        "demo-script-format",
        "audio-digest-format",
    )
    skills = [
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
    ]
    skills.extend(
        RawSkill(
            skill_path=f"skills/{name}/SKILL.md",
            content=_format_skill(name),
            commit_sha=sha,
        )
        for name in format_names
        if name != "blog-format"
    )
    return tuple(skills)


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

    assert {"brand-voice", "blog-format"} <= {s.skill_name for s in snapshots}
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


# --- T1/T2 (spec 007) generate the full initial artifact set in parallel ----------

# The full initial set (PRD §8.1); deferred types (§8.2) must never be produced.
_INITIAL_TYPES = frozenset(
    {
        "release_blog",
        "changelog_entry",
        "sales_onepager",
        "linkedin_post",
        "demo_script",
        "release_audio_digest",
    }
)
_DEFERRED_TYPES = frozenset(
    {
        "full_training_video",
        "battlecard_delta",
        "localized_assets",
        "autopublished_assets",
    }
)
# Each artifact type → the format skill it should be wired to (T2), alongside brand-voice.
_FORMAT_SKILL_BY_TYPE = {
    "release_blog": "blog-format",
    "changelog_entry": "changelog-format",
    "sales_onepager": "sales-onepager-format",
    "linkedin_post": "social-post-format",
    "demo_script": "demo-script-format",
    "release_audio_digest": "audio-digest-format",
}


def _snapshots():
    sink = InMemorySkillSnapshotSink()
    ids = (f"snap-{n}" for n in itertools.count())
    return snapshot_active_skills(_REPO, _raw_skills(), sink, lambda: next(ids))


def _generate():
    client = RecordingModelClient(_artifact_response())
    art_ids = (f"art-{n}" for n in itertools.count())
    artifacts, events = generate_artifacts_parallel(
        _RUN_ID,
        _approved_features(),
        _snapshots(),
        client,
        lambda: next(art_ids),
        model_id="bedrock-model-x",
    )
    return artifacts, events, client


def test_generate_produces_full_initial_set_as_drafts() -> None:
    """T1/AC: all initial artifact types generate as drafts; deferred types are not produced."""
    artifacts, _events, _client = _generate()

    types = {a.artifact_type for a in artifacts}
    assert types == _INITIAL_TYPES  # the four new types alongside blog + changelog
    assert types.isdisjoint(_DEFERRED_TYPES)  # §8.2 deferred types never produced
    for a in artifacts:
        assert a.status == "draft"  # no self-approval (§5)
        assert a.model_id == "bedrock-model-x"
        assert a.prompt_version == "content-gen-v1"


def test_generate_prompt_carries_only_features_and_skills_no_raw() -> None:
    """§5: the prompt is built from approved features + repo skill bodies, nothing raw."""
    artifacts, _events, client = _generate()

    # Every call's user prompt carries the approved features and nothing raw; every system
    # prompt carries brand-voice (it feeds every type).
    assert len(client.calls) == len(artifacts)
    for call in client.calls:
        assert "Admin-configurable onboarding checklist" in call.messages[0]["content"]
        assert "Brand Voice" in call.system  # shared voice skill injected per type


def test_generate_wires_each_type_to_its_format_skill() -> None:
    """T2: each artifact records exactly {its format skill, brand-voice} — not every skill."""
    artifacts, events, _client = _generate()

    events_by_artifact: dict[str, set[str]] = {}
    for e in events:
        events_by_artifact.setdefault(e.artifact_id, set()).add(e.skill_name)

    for a in artifacts:
        expected = {_FORMAT_SKILL_BY_TYPE[a.artifact_type], "brand-voice"}
        # skill_versions and the per-artifact usage events both reflect only that subset.
        assert set(a.skill_versions) == expected
        assert events_by_artifact[a.artifact_id] == expected
    assert all(e.usage_type == "generation" for e in events)
    assert all(e.graph_name == "content_generation_graph" for e in events)
    assert all(e.node_name == "generate_artifacts_parallel" for e in events)


def test_generate_idempotency_key_stable_for_same_inputs() -> None:
    """aws-bedrock-rules: a retried generation reuses the same dedupe key per type."""
    snapshots = _snapshots()
    client = RecordingModelClient(_artifact_response())
    art_ids = (f"art-{n}" for n in itertools.count())

    generate_artifacts_parallel(
        _RUN_ID,
        _approved_features(),
        snapshots,
        client,
        lambda: next(art_ids),
        model_id="m",
    )
    # Map task → key so the assertion is order-independent (the fan-out is concurrent).
    keys_first = {c.task_name: c.idempotency_key for c in client.calls}

    n_first = len(client.calls)
    generate_artifacts_parallel(
        _RUN_ID,
        tuple(reversed(_approved_features())),
        snapshots,
        client,
        lambda: next(art_ids),
        model_id="m",
    )
    keys_second = {c.task_name: c.idempotency_key for c in client.calls[n_first:]}
    assert keys_first == keys_second  # per-type, order- and feature-order-independent


def test_generate_rejects_malformed_model_output() -> None:
    client = RecordingModelClient({"title": "no body"})  # missing body_markdown
    art_ids = (f"art-{n}" for n in itertools.count())

    with pytest.raises(MalformedArtifactOutputError) as exc:
        generate_artifacts_parallel(
            _RUN_ID,
            _approved_features(),
            _snapshots(),
            client,
            lambda: next(art_ids),
            model_id="m",
        )
    assert "malformed" in str(exc.value)


# --- T3/T5 (spec 022) per-run artifact-type selection ------------------------------


def _generate_selected(selected: tuple[str, ...]):
    client = RecordingModelClient(_artifact_response())
    art_ids = (f"art-{n}" for n in itertools.count())
    artifacts, events = generate_artifacts_parallel(
        _RUN_ID,
        _approved_features(),
        _snapshots(),
        client,
        lambda: next(art_ids),
        model_id="m",
        selected_types=selected,
    )
    return artifacts, events, client


def test_generate_fans_out_only_selected_types() -> None:
    """T3/AC: the fan-out covers exactly the run's selection, in canonical order."""
    selected = ("changelog_entry", "linkedin_post")
    artifacts, _events, _client = _generate_selected(selected)

    assert tuple(a.artifact_type for a in artifacts) == selected


def test_generate_zero_spend_for_deselected_types() -> None:
    """T3/AC: deselected types incur ZERO model calls and zero usage events — the model
    client (the source of all Bedrock spend + telemetry rows) is never invoked for them."""
    selected = ("changelog_entry",)
    artifacts, events, client = _generate_selected(selected)

    assert len(client.calls) == 1  # one Bedrock call total: the one selected type
    assert {c.task_name for c in client.calls} == {"generate_changelog_entry"}
    assert {a.artifact_type for a in artifacts} == set(selected)
    # Usage events (→ telemetry rows) exist only for artifacts that were generated.
    generated_ids = {a.artifact_id for a in artifacts}
    assert all(e.artifact_id in generated_ids for e in events)


def test_generate_single_type_selection_runs_alone() -> None:
    """Boundary: a single-type selection produces exactly one draft, status='draft'."""
    artifacts, _events, _client = _generate_selected(("demo_script",))
    assert len(artifacts) == 1
    assert artifacts[0].artifact_type == "demo_script"
    assert artifacts[0].status == "draft"


def test_generate_default_selection_is_all_six() -> None:
    """Back-compat: omitting the selection keeps the full §8.1 fan-out (pre-022 behaviour)."""
    artifacts, _events, _client = _generate()
    assert {a.artifact_type for a in artifacts} == set(ARTIFACT_TYPES)


def test_selection_model_accepts_any_nonempty_subset() -> None:
    """The boundary model accepts single, partial, and full selections (spec AC)."""
    assert ArtifactTypeSelection(selected=("release_blog",)).selected == (
        "release_blog",
    )
    assert ArtifactTypeSelection(selected=ARTIFACT_TYPES).selected == ARTIFACT_TYPES


def test_selection_model_rejects_empty_unknown_and_duplicates() -> None:
    """P5: an empty, unknown, or duplicated selection read from the run row fails closed."""
    with pytest.raises(ValidationError):
        ArtifactTypeSelection(selected=())
    with pytest.raises(ValidationError) as unknown:
        ArtifactTypeSelection(selected=("release_blog", "full_training_video"))
    assert "unknown artifact types" in str(unknown.value)
    with pytest.raises(ValidationError) as dupes:
        ArtifactTypeSelection(selected=("release_blog", "release_blog"))
    assert "must not repeat" in str(dupes.value)


# --- T5 persist reviewable artifacts ----------------------------------------------


def test_persist_writes_artifacts_then_usage_events() -> None:
    """AC: artifacts persist (status=draft); usage events recorded. Artifacts first (FK)."""
    snapshots = _snapshots()
    client = RecordingModelClient(_artifact_response())
    art_ids = (f"art-{n}" for n in itertools.count())
    artifacts, events = generate_artifacts_parallel(
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
