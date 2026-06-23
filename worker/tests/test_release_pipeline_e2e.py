"""End-to-end test of the CORE product loop over a REAL GitHub release diff.

This is the one test that drives the whole reason the product exists: a release diff →
evidence → redaction → deterministic signals → feature manifest → Gate #1 → (human approve) →
recommended marketing content. It runs the production nodes and the compiled release-intelligence
graph against real-world input — deterministic, no network.

Input: the REAL compare diff of NousResearch/hermes-agent between its two releases
    "Hermes Agent v0.14.0"  -> git tag v2026.5.16   (base_ref)
    "Hermes Agent v0.17.0"  -> git tag v2026.6.19   (head_ref)
captured verbatim from the GitHub compare API into
``tests/fixtures/hermes_agent_v0_14_0__v0_17_0_compare.json`` (the exact dict shape
``GitHubDiffSource.fetch_raw_diff`` returns). The live equivalent is
``worker/integration_tests/test_hermes_release_integration.py`` (gated), which keeps this fixture
honest.

This real diff originally surfaced three bugs, now FIXED and guarded by the regression tests at the
bottom of this file (and unit tests in test_github_diff_source / test_redaction / test_signal_extractors):
  1. compare-API 300-file truncation was silent — now detected, flagged on the payload
     (``RawDiffPayload.truncated``), and warned in the collector.
  2. ``extract_ui_strings`` over-matched YAML ``description:`` / Markdown text as UI copy — now
     scoped to application source files.
  3. the IPv4 redaction regex masked 4-part version numbers (``S6_OVERLAY_VERSION=3.2.3.0``) — now
     preserved via a narrow version-context exception while real addresses stay redacted.
"""

from __future__ import annotations

import itertools
import json
import re
from pathlib import Path

import pytest

from release_worker.content_models import ApprovedFeature, RawSkill
from release_worker.content_nodes import (
    generate_artifacts_parallel,
    snapshot_active_skills,
)
from release_worker.content_ports import InMemorySkillSnapshotSink
from release_worker.evidence_models import EvidenceRecord, ReleaseBoundary
from release_worker.evidence_nodes import collect_redact_persist_all
from release_worker.evidence_ports import (
    InMemoryBoundaryReader,
    InMemoryEvidenceSink,
    StaticDiffSource,
    StaticPullRequestSource,
)
from release_worker.feature_nodes import cluster_features_with_bedrock
from release_worker.feature_ports import InMemoryFeatureSink
from release_worker.model_client import RecordingModelClient
from release_worker.repository import InMemoryReleaseRunRepository
from release_worker.state import ReleaseRunState
from release_worker.status import RunStatus

_FIXTURE = (
    Path(__file__).parent / "fixtures" / "hermes_agent_v0_14_0__v0_17_0_compare.json"
)
_RUN_ID = "a0000000-0000-4000-8000-000000000014"
_THREAD_ID = "thread-hermes-e2e"
_DASHBOARD = "https://app.example.test"
_REPO = "NousResearch/hermes-agent"

# A raw-secret signature set: NONE of these may survive into a persisted (redacted) excerpt.
_RAW_SECRET = re.compile(
    r"ghp_[A-Za-z0-9]{36}"  # GitHub token
    r"|AKIA[0-9A-Z]{16}"  # AWS access key id
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----"  # PEM private key
)


def _load_diff() -> dict[str, object]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _boundary() -> ReleaseBoundary:
    fx = _load_diff()
    return ReleaseBoundary(
        release_run_id=_RUN_ID,
        repo=str(fx["repo"]),
        base_ref=str(fx["base_ref"]),
        head_ref=str(fx["head_ref"]),
    )


def _collect() -> tuple[InMemoryEvidenceSink, tuple[EvidenceRecord, ...]]:
    """Run the real collect→redact→persist chain over the fixture diff (no PRs)."""
    reader = InMemoryBoundaryReader()
    reader.seed(_boundary())
    sink = InMemoryEvidenceSink()
    records = collect_redact_persist_all(
        _RUN_ID,
        reader,
        StaticDiffSource(_load_diff()),
        StaticPullRequestSource({}),
        sink,
    )
    return sink, records


class _SinkBackedEvidenceReader:
    """The ``RedactedEvidenceReader`` the release graph clusters from, bridged to the in-memory
    sink. The write (``EvidenceSink``) and read (``RedactedEvidenceReader``) seams are separate and
    there is no in-memory reader in source, so a test must connect them; this returns exactly the
    persisted ``EvidenceRecord``s for the run, like ``AuroraRedactedEvidenceReader`` would."""

    def __init__(self, sink: InMemoryEvidenceSink) -> None:
        self._sink = sink

    def list_redacted_evidence(self, release_run_id: str) -> tuple[EvidenceRecord, ...]:
        return tuple(
            r for r in self._sink.records if r.release_run_id == release_run_id
        )


class _DiffClusteringModelClient:
    """Stands in for Bedrock clustering. Like a real model it reads the evidence ids it was handed
    (the rendered ``[<id>] type=<t> file=<f>`` headers) and returns a manifest citing REAL ids, so
    every feature persists with valid evidence links. Deterministic: two marketable features."""

    _HEADER = re.compile(r"^\[([0-9a-f]+)\] type=(\S+) file=(.+)$", re.MULTILINE)

    def __init__(self) -> None:
        self.calls: list[str] = []

    def generate_json(
        self,
        task_name: str,
        system: str,
        messages: list[dict[str, str]],
        schema: dict[str, object],
        idempotency_key: str,
    ) -> dict[str, object]:
        self.calls.append(task_name)
        content = messages[0]["content"]
        by_type: dict[str, list[str]] = {}
        for match in self._HEADER.finditer(content):
            by_type.setdefault(match.group(2), []).append(match.group(1))

        features: list[dict[str, object]] = []
        ui_ids = by_type.get("ui_string_change", [])[:5]
        code_ids = (by_type.get("code_diff", []) + by_type.get("docs_delta", []))[:5]
        if ui_ids:
            features.append(
                {
                    "title": "Refreshed in-product copy and onboarding strings",
                    "summary_internal": "User-facing string changes across the app.",
                    "user_value": "Clearer prompts and labels when running agents.",
                    "audiences": ["end_user", "marketing"],
                    "change_type": "improvement",
                    "surface_area": ["desktop_app"],
                    "evidence_ids": ui_ids,
                    "demo_steps_draft": ["Open the app", "Show the updated prompts"],
                }
            )
        if code_ids:
            features.append(
                {
                    "title": "Hardened build, CI, and runtime adapter",
                    "summary_internal": "Docker/CI hardening and adapter changes this release.",
                    "user_value": "More reliable installs and runs across platforms.",
                    "audiences": ["developer"],
                    "change_type": "new_feature",
                    "surface_area": ["infrastructure"],
                    "evidence_ids": code_ids,
                    "demo_steps_draft": [],
                }
            )
        return {"features": features}


# --- Skill library for the content-generation leg (mirrors test_content_nodes) -------------------

_SKILL_BRAND = (
    "---\nname: brand-voice\nversion: 1.0.0\nstatus: active\nevolvable: true\n---\n"
    "# Brand Voice\nWrite clearly. No hype."
)
_FORMAT_SKILLS = (
    "blog-format",
    "changelog-format",
    "social-post-format",
)


def _raw_skills(sha: str = "deadbeefcafef00d") -> tuple[RawSkill, ...]:
    skills = [
        RawSkill(
            skill_path="skills/brand-voice/SKILL.md",
            content=_SKILL_BRAND,
            commit_sha=sha,
        )
    ]
    skills.extend(
        RawSkill(
            skill_path=f"skills/{name}/SKILL.md",
            content=f"---\nname: {name}\nversion: 1.0.0\n---\n# {name}\nGuidance.",
            commit_sha=sha,
        )
        for name in _FORMAT_SKILLS
    )
    return tuple(skills)


# --- 1. Evidence collection + redaction over the real diff ---------------------------------------


def test_real_diff_collects_redacts_and_extracts_signals() -> None:
    """The real release diff yields redacted evidence with deterministic signal types, and the
    redaction is airtight: it fires on the real secret/credential/IP the diff carries, and NO raw
    secret survives into any persisted excerpt (constitution §5, CRITICAL)."""
    _sink, records = _collect()

    types = {r.evidence_type for r in records}
    assert "code_diff" in types  # whole-file evidence per changed file
    assert "docs_delta" in types  # this repo ships heavy docs
    assert "ui_string_change" in types  # user-facing copy changes
    assert len(records) > 200, f"expected a rich evidence set, got {len(records)}"

    # Redaction fired on real data (the diff carries a credential + an IP-shaped token)...
    assert any(r.risk_flags for r in records), "redaction did not fire on the real diff"
    assert any("secret" in flag for r in records for flag in r.risk_flags)
    assert any("[redacted-secret]" in r.redacted_excerpt for r in records)
    # ...and nothing raw leaked through to a persisted excerpt.
    for r in records:
        assert not _RAW_SECRET.search(r.redacted_excerpt), (
            f"raw secret leaked into persisted evidence for {r.file_path}"
        )


# --- 2. The compiled release-intelligence graph through Gate #1 ----------------------------------


def test_release_graph_reaches_gate1_then_approves() -> None:
    """The real graph collects→clusters→persists→halts at Gate #1 (no self-approval), links every
    feature to >=1 REAL evidence item, and on human 'approved' advances to features_approved."""
    pytest.importorskip("langgraph")
    from langgraph.types import Command

    from release_worker.graph import build_release_intelligence_graph

    repo = InMemoryReleaseRunRepository()
    repo.seed_created(_RUN_ID)
    boundary_reader = InMemoryBoundaryReader()
    boundary_reader.seed(_boundary())
    evidence_sink = InMemoryEvidenceSink()
    evidence_reader = _SinkBackedEvidenceReader(evidence_sink)
    model_client = _DiffClusteringModelClient()
    feature_sink = InMemoryFeatureSink()

    graph = build_release_intelligence_graph(
        repo,
        boundary_reader,
        StaticDiffSource(_load_diff()),
        StaticPullRequestSource({}),
        evidence_sink,
        evidence_reader,
        model_client,
        feature_sink,
        dashboard_base_url=_DASHBOARD,
    )
    config = {"configurable": {"thread_id": _THREAD_ID}}

    result = graph.invoke(
        ReleaseRunState(release_run_id=_RUN_ID, thread_id=_THREAD_ID), config
    )

    # Halts at Gate #1 with the manifest-approval payload — content does not flow yet (§5).
    assert "__interrupt__" in result
    payload = result["__interrupt__"][0].value
    assert payload["gate"] == "feature_manifest_approval"
    assert payload["features_pending_review"] == len(feature_sink.features)
    assert len(feature_sink.features) > 0
    assert repo.get_status(_RUN_ID) == RunStatus.FEATURES_PENDING_REVIEW

    # Every persisted feature links to >=1 REAL evidence id (no dangling/hallucinated links).
    assert feature_sink.links
    linked_ids = {ev_id for _fid, ev_id, _score in feature_sink.links}
    real_ids = {r.evidence_id for r in evidence_sink.records}
    assert linked_ids <= real_ids

    # Human approves -> run reaches the Gate #1 'approved' status.
    graph.invoke(Command(resume="approved"), config)
    assert repo.get_status(_RUN_ID) == RunStatus.FEATURES_APPROVED
    assert repo.transitions[_RUN_ID][-1] == RunStatus.FEATURES_APPROVED


# --- 3. The payoff: diff-derived approved features -> recommended marketing content ---------------


def test_approved_diff_features_generate_marketing_content() -> None:
    """Approved, diff-grounded features generate recommended marketing artifacts (blog, changelog,
    social) as DRAFTS with skill/model provenance — the core 'diff → on-brand content' outcome."""
    sink, _records = _collect()
    evidence = _SinkBackedEvidenceReader(sink).list_redacted_evidence(_RUN_ID)

    candidates = cluster_features_with_bedrock(
        _RUN_ID, evidence, _DiffClusteringModelClient()
    )
    assert candidates, "clustering produced no features from the real diff"

    approved = tuple(
        ApprovedFeature(
            feature_id=f"feat-{i}",
            release_run_id=_RUN_ID,
            title=c.title,
            summary_internal=c.summary_internal,
            user_value=c.user_value,
            audiences=c.audiences,
            change_type=c.change_type,
            surface_area=c.surface_area,
        )
        for i, c in enumerate(candidates)
    )

    snapshot_sink = InMemorySkillSnapshotSink()
    snap_ids = (f"snap-{n}" for n in itertools.count())
    snapshots = snapshot_active_skills(
        _REPO, _raw_skills(), snapshot_sink, lambda: next(snap_ids)
    )

    content_client = RecordingModelClient(
        {
            "title": "Hermes Agent v0.17.0 — what shipped",
            "body_markdown": "# Hermes Agent v0.17.0\n\nHighlights from this release.",
        }
    )
    art_ids = (f"art-{n}" for n in itertools.count())
    selected = ("release_blog", "changelog_entry", "linkedin_post")

    artifacts, usage = generate_artifacts_parallel(
        _RUN_ID,
        approved,
        snapshots,
        content_client,
        lambda: next(art_ids),
        model_id="bedrock-test-model",
        selected_types=selected,
    )

    assert {a.artifact_type for a in artifacts} == set(selected)
    for a in artifacts:
        assert a.status == "draft"  # no auto-publish (constitution §5)
        assert a.body_markdown.strip()  # non-empty content
        assert a.skill_versions  # skill provenance recorded (§18.3)
        assert a.model_id == "bedrock-test-model"
    assert usage, "skill-usage provenance recorded for the generated content"


# --- Regression guards for the three fixes (were KNOWN GAPS, fixed 2026-06-22) -------------------
# Originally characterizations of bugs this real diff surfaced; now they assert the corrected
# behaviour so a regression re-opens the gap loudly.


def test_ui_string_extraction_is_scoped_to_app_source_files() -> None:
    """FIXED (precision): extract_ui_strings no longer treats YAML ``description:`` or Markdown
    heading/link text as UI copy. Over this real diff, every ui_string_change now comes from an
    application source file — none from CI YAML / .github or Markdown docs (which have docs_delta)."""
    _sink, records = _collect()
    ui = [r for r in records if r.evidence_type == "ui_string_change"]
    assert ui, "expected real UI strings from the app source files in this diff"
    non_ui_sources = [
        r
        for r in ui
        if r.file_path.endswith((".yml", ".yaml", ".md", ".mdx", ".rst"))
        or "/.github/" in r.file_path
        or r.file_path.startswith(".github/")
    ]
    assert non_ui_sources == [], (
        f"ui_string extraction leaked from non-UI files: "
        f"{[r.file_path for r in non_ui_sources]}"
    )


def test_ipv4_redaction_preserves_version_numbers_but_masks_real_ips() -> None:
    """FIXED (precision): the Dockerfile ``ARG S6_OVERLAY_VERSION=3.2.3.0`` is preserved (a version,
    not an address), so the Dockerfile is no longer ip-flagged — while real addresses elsewhere are
    still redacted (covered by the redaction unit tests)."""
    _sink, records = _collect()
    docker = [r for r in records if r.file_path == "Dockerfile"]
    assert docker, "expected the Dockerfile in the diff"
    assert all("ip" not in r.risk_flags for r in docker)
    assert all("[redacted-ip]" not in r.redacted_excerpt for r in docker)
    assert any("S6_OVERLAY_VERSION=3.2.3.0" in r.redacted_excerpt for r in docker)


def test_diff_truncation_is_surfaced_not_silent() -> None:
    """FIXED (coverage): the real compare hit GitHub's 300-file cap, so the captured diff is marked
    truncated. The validated payload carries the flag (and the collector logs a warning) instead of
    silently building content from a partial, path-biased subset."""
    from release_worker.evidence_models import RawDiffPayload

    payload = RawDiffPayload.model_validate(_load_diff())
    assert payload.truncated is True, (
        "the fixture records the real 300-file truncation; the payload must expose it so "
        "downstream/UI can warn rather than silently use a partial diff"
    )
