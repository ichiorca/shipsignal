"""T2/T3/T4/T5 (spec 005) / T1,T2 (spec 007) — the content_generation_graph nodes (PRD §5.3):
snapshot_active_skills → load_approved_features → generate_artifacts_parallel → persist_reviewable_artifacts.

T1/T2 (spec 007) expand ``generate_artifacts`` into ``generate_artifacts_parallel``: the full
initial artifact set (PRD §8.1 — blog, changelog, sales one-pager, social post, demo script,
audio digest) is generated concurrently, each on its own per-type format-skill selection
(``_skills_for_spec``) plus the shared brand-voice. Deferred types (§8.2) are never produced.

Each node is a pure function of ``(inputs, port)`` — no langgraph/psycopg/boto3 import —
so it is unit-tested through the exact surface the graph invokes (anti-pattern #4). The
constitution's load-bearing rules are enforced *structurally*:

* §5 / §9.2 — the canonical skill is the repo SKILL.md: ``snapshot_active_skills`` only
  records provenance (path + commit + content hash) into Aurora; it never treats Aurora as
  the source of truth.
* §5 — no generation from unapproved work: ``load_approved_features`` refuses to proceed
  with zero approved features, and the reader returns only approved ones.
* §5 — model output is untrusted: each artifact body is validated through
  ``GeneratedArtifact`` before persist; a hallucinated/malformed payload fails closed.
* §5 — no self-approval: every persisted artifact is ``status='draft'``; Gate #2 (a later
  spec) is the only path to 'approved'.
* §18.3 — audit trail: each draft records model_id + prompt_version + skill content hashes,
  and a ``skill_usage_events`` row is written per (artifact, skill snapshot).
"""

from __future__ import annotations

import concurrent.futures
import hashlib
from collections.abc import Callable
from dataclasses import dataclass

from pydantic import ValidationError

from release_worker.content_models import (
    ARTIFACT_TYPES,
    ApprovedFeature,
    ArtifactDraft,
    GeneratedArtifact,
    MalformedArtifactOutputError,
    NoApprovedFeaturesError,
    RawSkill,
    SkillSnapshot,
    SkillUsageEvent,
)
from release_worker.content_ports import (
    ApprovedFeatureReader,
    ArtifactSink,
    SkillSnapshotSink,
)
from release_worker.model_client import ModelClient

_GRAPH_NAME = "content_generation_graph"
# Bumped whenever the prompt/template below changes so the audit trail (§18.3) records
# which template produced a draft.
PROMPT_VERSION = "content-gen-v1"
# Per §9.1 a body excerpt is enough provenance + prompt context; bound it so a huge skill
# file can't blow the prompt/token budget (constitution §6 cost/latency).
_BODY_EXCERPT_CHARS = 800

# --- T2 — snapshot active repo skills ---------------------------------------------


def parse_frontmatter(content: str) -> tuple[dict[str, str | bool], str]:
    """Parse a SKILL.md's leading ``---`` YAML-ish frontmatter into a flat scalar map.

    The PRD §9.1 frontmatter is all flat ``key: value`` scalars, so a tiny deterministic
    parser avoids a YAML dependency (dependency-policy: prefer stdlib). Untrusted input is
    handled defensively: only ``str``/``bool`` values are produced (``true``/``false`` →
    bool), nested structures are impossible, and a file with no/!malformed fence yields an
    empty map plus the whole content as body. Returns ``(frontmatter, body)``.
    """
    lines = content.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, content.strip()

    frontmatter: dict[str, str | bool] = {}
    index = 1
    while index < len(lines) and lines[index].strip() != "---":
        key, sep, raw_value = lines[index].partition(":")
        if sep:
            name = key.strip()
            value = raw_value.strip().strip("\"'")
            if name:
                lowered = value.lower()
                frontmatter[name] = (
                    lowered == "true" if lowered in ("true", "false") else value
                )
        index += 1

    body = "\n".join(lines[index + 1 :]).strip() if index < len(lines) else ""
    return frontmatter, body


def _skill_name(frontmatter: dict[str, str | bool], skill_path: str) -> str:
    """The skill's name: the frontmatter ``name`` if a non-empty string, else the parent
    directory name (``skills/<name>/SKILL.md``) as a deterministic fallback."""
    name = frontmatter.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    parts = [p for p in skill_path.replace("\\", "/").split("/") if p]
    # …/<name>/SKILL.md → the parent of the file; fall back to the filename stem.
    return parts[-2] if len(parts) >= 2 else (parts[-1] if parts else "skill")


def _content_hash(content: str) -> str:
    """Tamper-evident hash of the whole SKILL.md (§10.5 content_hash)."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def snapshot_active_skills(
    repo: str,
    raw_skills: tuple[RawSkill, ...],
    sink: SkillSnapshotSink,
    new_snapshot_id: Callable[[], str],
) -> tuple[SkillSnapshot, ...]:
    """Snapshot the repo's active skills into Aurora (T2, PRD §9.3 step 2 / §10.5).

    For each SKILL.md: parse frontmatter, compute the content hash, and upsert a
    ``skill_repo_snapshots`` row keyed on (repo, skill_path, commit_sha). The upsert returns
    the *effective* id (the existing row's on a re-snapshot of the same commit), which is
    what the returned ``SkillSnapshot`` carries so usage events link to the real row.

    The repo SKILL.md remains canonical (§9.2): this only records provenance. ``new_snapshot_id``
    is injected (not ``uuid4`` inline) so the node stays pure and tests get deterministic ids.
    Snapshots are returned sorted by skill_path for a deterministic downstream prompt.
    """
    snapshots: list[SkillSnapshot] = []
    for raw in sorted(raw_skills, key=lambda s: s.skill_path):
        frontmatter, body = parse_frontmatter(raw.content)
        version = frontmatter.get("version")
        candidate = SkillSnapshot(
            snapshot_id=new_snapshot_id(),
            repo=repo,
            skill_name=_skill_name(frontmatter, raw.skill_path),
            skill_path=raw.skill_path,
            skill_version=version if isinstance(version, str) else None,
            commit_sha=raw.commit_sha,
            content_hash=_content_hash(raw.content),
            frontmatter=frontmatter,
            body_excerpt=body[:_BODY_EXCERPT_CHARS],
            is_active=True,
        )
        effective_id = sink.upsert_snapshot(candidate)
        snapshots.append(candidate.model_copy(update={"snapshot_id": effective_id}))
    return tuple(snapshots)


# --- T3 — load approved features --------------------------------------------------


def load_approved_features(
    release_run_id: str,
    reader: ApprovedFeatureReader,
) -> tuple[ApprovedFeature, ...]:
    """Load only Gate#1-approved features for the run (T3, PRD §5.3).

    Refuses to proceed when none are approved (AC: "with zero approved features the graph
    does not produce artifacts") by raising ``NoApprovedFeaturesError`` — the graph fails
    closed rather than generating from nothing. The reader already filters to
    ``status='approved'`` so rejected/edited features can never reach generation (§5).
    """
    features = reader.list_approved_features(release_run_id)
    if not features:
        raise NoApprovedFeaturesError()
    return features


# --- T1/T2 (spec 007) — generate the full initial artifact set in parallel ---------


@dataclass(frozen=True)
class _ArtifactSpec:
    """One initial artifact type (PRD §8.1) and the format SKILL.md that shapes it.

    T2 (spec 007): each type is wired to its own format skill rather than feeding every
    skill into every artifact — a sales one-pager follows ``sales-onepager-format``, a demo
    script follows ``demo-script-format``, etc. The shared ``brand-voice`` skill applies to
    every type (added in ``_skills_for_spec``), so each generation prompt carries exactly
    {that type's format skill, brand-voice} and nothing else.
    """

    artifact_type: str
    label: str
    format_skill: str


# The voice skill layered onto every artifact type (PRD §9.1 brand-voice).
_BRAND_VOICE_SKILL = "brand-voice"

# T1 (spec 007): the full initial artifact set (PRD §8.1). Blog + changelog shipped in
# spec 005; this expands generation to the remaining four — sales one-pager, social post,
# demo script, and release audio digest. Deferred types (PRD §8.2) are intentionally absent,
# so the graph never produces them (AC: "deferred types are not produced"). Ordering is
# canonical so the parallel fan-out yields a deterministic artifact sequence.
_ARTIFACT_SPECS: tuple[_ArtifactSpec, ...] = (
    _ArtifactSpec("release_blog", "release blog post", "blog-format"),
    _ArtifactSpec("changelog_entry", "product changelog entry", "changelog-format"),
    _ArtifactSpec(
        "sales_onepager",
        "sales one-pager with value prop, use cases, objections, and talk track",
        "sales-onepager-format",
    ),
    _ArtifactSpec(
        "linkedin_post",
        "short LinkedIn/social announcement post",
        "social-post-format",
    ),
    _ArtifactSpec(
        "demo_script",
        "demo video script with a screen-flow plan",
        "demo-script-format",
    ),
    _ArtifactSpec(
        "release_audio_digest",
        "short narrated internal audio-digest script",
        "audio-digest-format",
    ),
)

# Bound the fan-out so a large artifact set can't open an unbounded number of concurrent
# Bedrock calls (constitution §6 cost/latency; aws-bedrock-rules throttle discipline).
_MAX_GENERATION_WORKERS = 6


def _skills_for_spec(
    spec: _ArtifactSpec, snapshots: tuple[SkillSnapshot, ...]
) -> tuple[SkillSnapshot, ...]:
    """The active skill snapshots that feed one artifact type: its format skill + brand-voice.

    T2 (spec 007): selects only the relevant snapshots from the active set so the prompt and
    the recorded ``skill_usage_events`` reflect exactly which skills shaped this artifact —
    not the whole repo skill list. A format skill absent from the snapshot set is simply
    skipped (the artifact still generates under brand-voice), so a missing optional skill
    never fails the run. Order follows the snapshot order for a deterministic prompt.
    """
    wanted = {spec.format_skill, _BRAND_VOICE_SKILL}
    return tuple(s for s in snapshots if s.skill_name in wanted)


_GENERATE_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "body_markdown": {"type": "string"},
    },
    "required": ["title", "body_markdown"],
}


def _render_features(features: tuple[ApprovedFeature, ...]) -> str:
    """Render approved features into the (redacted, approved-only) user prompt body.

    Deterministic ordering by feature_id so the idempotency hash is stable across retries.
    """
    blocks: list[str] = []
    for feature in sorted(features, key=lambda f: f.feature_id):
        lines = [f"[{feature.feature_id}] {feature.title}"]
        if feature.user_value:
            lines.append(f"User value: {feature.user_value}")
        if feature.summary_internal:
            lines.append(f"Summary: {feature.summary_internal}")
        if feature.audiences:
            lines.append(f"Audiences: {', '.join(feature.audiences)}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def _render_skills(snapshots: tuple[SkillSnapshot, ...]) -> str:
    """Render the loaded skill guidance into the system prompt, deterministically ordered.

    Only ``body_excerpt`` (repo-authored, non-PII) is injected — never evidence or PII."""
    blocks: list[str] = []
    for snap in sorted(snapshots, key=lambda s: s.skill_name):
        version = f" v{snap.skill_version}" if snap.skill_version else ""
        blocks.append(f"[{snap.skill_name}{version}]\n{snap.body_excerpt}")
    return "\n\n".join(blocks)


def _system_prompt(artifact_label: str, snapshots: tuple[SkillSnapshot, ...]) -> str:
    skills = _render_skills(snapshots)
    guidance = f"\n\n--- SKILL GUIDANCE ---\n{skills}" if skills else ""
    return (
        f"You write release content. Generate a {artifact_label} from the APPROVED "
        "release features supplied by the user. Use ONLY those features; never invent "
        "capabilities, metrics, percentages, customer names, or availability dates. "
        "Follow the brand voice and format guidance. Return strict JSON matching the "
        f"provided schema (a title and a Markdown body).{guidance}"
    )


def _idempotency_key(
    artifact_type: str,
    release_run_id: str,
    features: tuple[ApprovedFeature, ...],
    snapshots: tuple[SkillSnapshot, ...],
) -> str:
    """Deterministic dedupe key for one generation call (aws-bedrock-rules: Converse has no
    idempotency of its own). Same run + artifact type + approved-feature set + loaded skill
    versions → same key, so a retried job neither re-bills nor double-generates."""
    digest = hashlib.sha256()
    digest.update(artifact_type.encode("utf-8"))
    digest.update(b"\x00")
    digest.update(release_run_id.encode("utf-8"))
    for feature in sorted(features, key=lambda f: f.feature_id):
        digest.update(b"\x00f")
        digest.update(feature.feature_id.encode("utf-8"))
        digest.update(feature.title.encode("utf-8"))
        digest.update(feature.user_value.encode("utf-8"))
    for snap in sorted(snapshots, key=lambda s: s.skill_name):
        digest.update(b"\x00s")
        digest.update(snap.content_hash.encode("utf-8"))
    return digest.hexdigest()


def _generate_one(
    spec: _ArtifactSpec,
    release_run_id: str,
    features: tuple[ApprovedFeature, ...],
    type_snapshots: tuple[SkillSnapshot, ...],
    model_client: ModelClient,
) -> GeneratedArtifact:
    """Run one artifact type's Bedrock Converse call and validate the untrusted output.

    The prompt carries only approved features (built from redacted evidence) and this type's
    selected skill bodies — nothing raw (§5). A malformed payload fails closed as
    ``MalformedArtifactOutputError`` (AC4) without echoing the offending content. Pure of any
    id minting or list mutation so it is safe to run concurrently across types (T1)."""
    messages = [{"role": "user", "content": _render_features(features)}]
    raw = model_client.generate_json(
        f"generate_{spec.artifact_type}",
        _system_prompt(spec.label, type_snapshots),
        messages,
        _GENERATE_SCHEMA,
        _idempotency_key(spec.artifact_type, release_run_id, features, type_snapshots),
    )
    try:
        return GeneratedArtifact.model_validate(raw)
    except ValidationError as err:
        raise MalformedArtifactOutputError() from err


def generate_artifacts_parallel(
    release_run_id: str,
    features: tuple[ApprovedFeature, ...],
    snapshots: tuple[SkillSnapshot, ...],
    model_client: ModelClient,
    new_artifact_id: Callable[[], str],
    model_id: str,
    prompt_version: str = PROMPT_VERSION,
    selected_types: tuple[str, ...] = ARTIFACT_TYPES,
) -> tuple[tuple[ArtifactDraft, ...], tuple[SkillUsageEvent, ...]]:
    """Generate the run's SELECTED artifact types in parallel via Bedrock Converse
    (T1, PRD §5.3/§8.1; T3 spec 022).

    The initial types (blog, changelog, sales one-pager, social post, demo script, audio
    digest) fan out concurrently — each on its own per-type skill selection (T2) — because the
    Bedrock calls are independent I/O; running them together keeps the node within the
    latency budget (constitution §6) instead of summing six sequential round-trips. The
    deferred types (PRD §8.2) are never in ``_ARTIFACT_SPECS`` so they are never produced (AC).

    T3 (spec 022) — ``selected_types`` (the run's validated per-run selection, PRD §14.1 /
    §17.1) filters the fan-out BEFORE any planning: a deselected type is never planned, so
    it incurs zero Bedrock calls, zero ``artifacts`` rows, and zero telemetry/usage events
    (AC: deselected types cost nothing). Default = all six, the pre-selection behaviour.

    Determinism is preserved despite the concurrency: artifact ids are minted up front on the
    calling thread in canonical order (so ``new_artifact_id`` — a generator in tests — is never
    raced), and results are stitched back in that same order via ``executor.map``. Each
    response is validated through ``GeneratedArtifact`` (untrusted model output, AC) and minted
    ``status='draft'`` with the model/prompt/skill provenance (§18.3). For every skill that fed
    a given artifact a ``skill_usage_events`` row is produced (AC: each artifact records which
    skill versions/hashes were loaded). Returns ``(artifacts, usage_events)`` for the persist node.
    """
    # Mint ids + resolve each type's skills on the calling thread (deterministic, race-free).
    # Deselected types are excluded HERE, before id minting or any model I/O (spec 022 AC:
    # zero spend); canonical _ARTIFACT_SPECS order is kept regardless of selection order.
    planned: list[tuple[_ArtifactSpec, tuple[SkillSnapshot, ...], str]] = [
        (spec, _skills_for_spec(spec, snapshots), new_artifact_id())
        for spec in _ARTIFACT_SPECS
        if spec.artifact_type in selected_types
    ]
    if not planned:
        return (), ()

    workers = min(len(planned), _MAX_GENERATION_WORKERS)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        # map preserves input order and re-raises the first exception on iteration, so a
        # single malformed artifact fails the whole node closed (§5) rather than half-persisting.
        generated = list(
            executor.map(
                lambda item: _generate_one(
                    item[0], release_run_id, features, item[1], model_client
                ),
                planned,
            )
        )

    artifacts: list[ArtifactDraft] = []
    events: list[SkillUsageEvent] = []
    for (spec, type_snapshots, artifact_id), result in zip(
        planned, generated, strict=True
    ):
        # skill_versions records only the skills that actually shaped THIS artifact (T2).
        skill_versions = {s.skill_name: s.content_hash for s in type_snapshots}
        artifacts.append(
            ArtifactDraft(
                artifact_id=artifact_id,
                release_run_id=release_run_id,
                feature_id=None,  # release-level: artifacts span all approved features
                artifact_type=spec.artifact_type,
                title=result.title,
                body_markdown=result.body_markdown,
                status="draft",
                model_id=model_id,
                prompt_version=prompt_version,
                skill_versions=skill_versions,
            )
        )
        for snap in type_snapshots:
            events.append(
                SkillUsageEvent(
                    release_run_id=release_run_id,
                    artifact_id=artifact_id,
                    graph_name=_GRAPH_NAME,
                    node_name="generate_artifacts_parallel",
                    skill_snapshot_id=snap.snapshot_id,
                    skill_name=snap.skill_name,
                    skill_version=snap.skill_version,
                    content_hash=snap.content_hash,
                    usage_type="generation",
                )
            )
    return tuple(artifacts), tuple(events)


# --- T5 — persist reviewable artifacts --------------------------------------------


def persist_reviewable_artifacts(
    artifacts: tuple[ArtifactDraft, ...],
    events: tuple[SkillUsageEvent, ...],
    sink: ArtifactSink,
) -> tuple[str, ...]:
    """Persist the draft artifacts + their skill-usage events (T5, PRD §10.3/§10.5).

    Artifacts are inserted first because the usage events FK-reference the artifact row.
    Every artifact is ``status='draft'`` (no self-approval, §5). Returns the inserted
    artifact ids for the caller's audit/log.
    """
    inserted: list[str] = []
    for artifact in artifacts:
        sink.insert_artifact(artifact)
        inserted.append(artifact.artifact_id)
    for event in events:
        sink.record_skill_usage(event)
    return tuple(inserted)
