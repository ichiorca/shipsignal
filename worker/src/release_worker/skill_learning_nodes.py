"""T2/T3/T4/T6 (spec 009) — the node logic of ``skill_learning_graph`` (PRD §5.5):
collect_learning_signals → cluster_edit_patterns → cluster_rejection_patterns →
select_impacted_skills → draft_skill_revision_candidate → persist_candidate_in_aurora →
approve_skill_candidate (interrupt) → update_repo_skill_file → mark_candidate_promoted
(approved) | record_rejection_and_suppression (rejected).

Each node is a pure function of ``(inputs, port)`` — no langgraph/psycopg/boto3/repo-write
import — so it is unit-tested through the exact surface the graph invokes (anti-pattern #4).
The constitution's load-bearing rules are enforced *structurally*:

* §5 — model output is untrusted: ``draft_skill_revision_candidate`` validates the Bedrock
  response through ``SkillRevisionDraft`` (a malformed payload fails closed) and stores the body
  as TEXT only — it is never executed.
* §5 / §9.4 — no silent overwrite: a candidate is only ever persisted ``status='draft'``; the
  repo file is written ONLY by ``update_repo_skill_file``, which the graph reaches only on the
  approved branch of the Gate #3 interrupt. Clustering + drafting + persistence never touch the
  working tree.
* §9.4.7 / AC3 — cooldown: ``draft_skill_revision_candidate`` skips a skill whose normalized
  ``pattern_hash`` is currently suppressed, so a near-duplicate of a rejected candidate is not
  re-proposed; ``record_rejection_and_suppression`` opens the window on a rejection.
* §6 (cost/latency) — clustering + scoring are deterministic rules, not extra model calls.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable

from pydantic import ValidationError

from release_worker.content_nodes import parse_frontmatter
from release_worker.feature_models import GateDecision
from release_worker.model_client import ModelClient
from release_worker.skill_learning_models import (
    Gate3Payload,
    ImpactedSkill,
    LearningSignal,
    LearningSignalType,
    MalformedSkillDraftError,
    PromotionRecord,
    RawReviewSignal,
    SignalCluster,
    SkillGateResolution,
    SkillRevisionCandidate,
    SkillRevisionDraft,
)
from release_worker.skill_learning_ports import (
    ActiveSkillReader,
    LearningSignalSink,
    LearningSignalSource,
    RepoSkillWriter,
    SkillCandidateSink,
    SuppressionStore,
)

# Bumped whenever the draft prompt/template changes so the audit trail records which template
# produced a candidate body (§18.3).
DRAFT_PROMPT_VERSION = "skill-draft-v1"
# The miner that produced the candidate (PRD §9.5 "Candidate source"); this is the deterministic
# self-learning miner, not a per-voice miner.
MINER_TYPE = "self_learning"
# Default cooldown window (days) a rejected candidate's pattern is suppressed for (§9.4.7).
DEFAULT_COOLDOWN_DAYS = 30

# Unverifiable superlatives/absolutes — when a reviewer edit removes one, the theme is "reduce
# hype" (mirrors the §12.3 advisory list the claim checker uses).
_SUPERLATIVES = re.compile(
    r"(?i)\b(?:best|fastest|cheapest|guaranteed|unlimited|world[- ]class|"
    r"never|always|#1|number one|industry[- ]leading|revolutionary|game[- ]changing)\b"
)
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


# --- T2 — collect learning signals ------------------------------------------------


def _line_diff(source_text: str, revised_text: str) -> dict[str, tuple[str, ...]]:
    """Deterministic line-level diff of an edit: lines removed vs added (order-preserving).

    Dependency-free + reproducible (no model call). Empty when nothing changed."""
    source_lines = source_text.splitlines()
    revised_lines = revised_text.splitlines()
    removed = tuple(line for line in source_lines if line not in revised_lines)
    added = tuple(line for line in revised_lines if line not in source_lines)
    diff: dict[str, tuple[str, ...]] = {}
    if removed:
        diff["removed"] = removed
    if added:
        diff["added"] = added
    return diff


def collect_learning_signals(
    release_run_id: str,
    source: LearningSignalSource,
    sink: LearningSignalSink,
    new_signal_id: Callable[[], str],
) -> tuple[LearningSignal, ...]:
    """Mine a run's recorded Gate #1/#2 review actions into ``learning_signals`` (T2, PRD §9.3 step 4).

    Each raw review record (a reviewer edit, a rejected claim, a review note) is validated through
    ``RawReviewSignal`` (untrusted boundary data) and persisted as a ``LearningSignal`` tagged with
    the skill snapshots that were active for the reviewed artifact — so it can later be attributed
    to the skills that shaped the content. For an edit signal the line-level diff is computed and
    stored. ``new_signal_id`` is injected so the node stays pure. Returns the persisted signals.
    """
    signals: list[LearningSignal] = []
    for raw in source.collect_review_signals(release_run_id):
        record = RawReviewSignal.model_validate(raw)
        diff = (
            _line_diff(record.source_text, record.revised_text)
            if record.signal_type is LearningSignalType.REVIEWER_EDIT
            else {}
        )
        signal = LearningSignal(
            signal_id=new_signal_id(),
            release_run_id=release_run_id,
            artifact_id=record.artifact_id,
            signal_type=record.signal_type.value,
            source_text=record.source_text,
            revised_text=record.revised_text,
            diff=diff,
            reviewer=record.reviewer,
            rejection_category=record.rejection_category,
            severity=record.severity,
            related_skill_snapshot_ids=record.related_skill_snapshot_ids,
        )
        sink.insert_signal(signal)
        signals.append(signal)
    return tuple(signals)


# --- T3 — cluster edit + rejection patterns, select impacted skills ----------------


def _edit_theme(signal: LearningSignal) -> str:
    """Normalized theme of one reviewer edit, from what the edit removed (deterministic).

    A removed superlative → ``reduce_hype``; a removed numeric figure that is not in the revised
    text → ``remove_unsupported_metric``; anything else → ``tighten_wording``. The theme feeds the
    candidate ``pattern_hash`` (so a near-duplicate re-mine suppresses) and the draft prompt.
    """
    removed = " ".join(signal.diff.get("removed", ()))
    if _SUPERLATIVES.search(removed):
        return "reduce_hype"
    removed_numbers = set(_NUMBER.findall(removed))
    if removed_numbers and not removed_numbers <= set(
        _NUMBER.findall(signal.revised_text)
    ):
        return "remove_unsupported_metric"
    return "tighten_wording"


def _grouped_clusters(
    signals: tuple[LearningSignal, ...],
    signal_type: LearningSignalType,
    theme_of: Callable[[LearningSignal], str],
) -> tuple[SignalCluster, ...]:
    """Group signals of one type by their normalized theme into deterministic clusters.

    A cluster carries the union of its signals' ids + their related snapshot ids (the skill
    attribution ``select_impacted_skills`` matches on). Themes are emitted in sorted order so the
    cluster sequence is reproducible.
    """
    by_theme: dict[str, list[LearningSignal]] = {}
    for signal in signals:
        if signal.signal_type == signal_type.value:
            by_theme.setdefault(theme_of(signal), []).append(signal)

    clusters: list[SignalCluster] = []
    for theme in sorted(by_theme):
        members = by_theme[theme]
        signal_ids = tuple(s.signal_id for s in members)
        snapshot_ids = tuple(
            sorted({sid for s in members for sid in s.related_skill_snapshot_ids})
        )
        clusters.append(
            SignalCluster(
                signal_type=signal_type.value,
                theme=theme,
                signal_ids=signal_ids,
                snapshot_ids=snapshot_ids,
            )
        )
    return tuple(clusters)


def cluster_edit_patterns(
    signals: tuple[LearningSignal, ...],
) -> tuple[SignalCluster, ...]:
    """Cluster reviewer-edit signals by normalized edit theme (T3, PRD §5.5 cluster_edit_patterns).

    Deterministic (no model call, constitution §6): edits that remove hype, drop unsupported
    metrics, or tighten wording each form their own theme cluster.
    """
    return _grouped_clusters(signals, LearningSignalType.REVIEWER_EDIT, _edit_theme)


def _rejection_theme(signal: LearningSignal) -> str:
    """Normalized theme of a rejected-claim signal: its rejection category (fallback ``general``)."""
    category = (signal.rejection_category or "").strip().lower().replace(" ", "_")
    return category or "general"


def cluster_rejection_patterns(
    signals: tuple[LearningSignal, ...],
) -> tuple[SignalCluster, ...]:
    """Cluster rejected-claim signals by rejection category (T3, PRD §5.5 cluster_rejection_patterns).

    Deterministic: claims rejected for the same reason (e.g. ``unsupported_metric``,
    ``off_brand``) cluster together so the miner addresses that recurring failure in the skill.
    """
    return _grouped_clusters(
        signals, LearningSignalType.REJECTED_CLAIM, _rejection_theme
    )


def select_impacted_skills(
    clusters: tuple[SignalCluster, ...],
    reader: ActiveSkillReader,
) -> tuple[ImpactedSkill, ...]:
    """Map clusters to the active repo skills they touch (T3, PRD §5.5 select_impacted_skills).

    The active skills are resolved from the snapshots the signals reference (the canonical repo
    body, §9.2). A cluster attributes to a skill when the skill's active snapshot id is among the
    cluster's related snapshot ids; a skill with no matching cluster is skipped (we never propose
    against an unattributed skill). Returns one ``ImpactedSkill`` per touched skill (sorted by
    path) carrying its clusters + the union of supporting signal ids.
    """
    all_snapshot_ids = tuple(
        sorted({sid for cluster in clusters for sid in cluster.snapshot_ids})
    )
    if not all_snapshot_ids:
        return ()

    actives = reader.active_skills_for_snapshots(all_snapshot_ids)
    impacted: list[ImpactedSkill] = []
    for skill in sorted(actives, key=lambda s: s.skill_path):
        matching = tuple(c for c in clusters if skill.snapshot_id in c.snapshot_ids)
        if not matching:
            continue
        supporting = tuple(
            sorted({sid for cluster in matching for sid in cluster.signal_ids})
        )
        impacted.append(
            ImpactedSkill(
                skill=skill,
                clusters=matching,
                supporting_signal_ids=supporting,
            )
        )
    return tuple(impacted)


# --- T4 — draft + persist the staged candidate ------------------------------------


def _pattern_hash(skill_name: str, clusters: tuple[SignalCluster, ...]) -> str:
    """Normalized signature of (skill + the clustered signal shape) for cooldown suppression.

    Keyed on the skill name + the sorted unique cluster themes — NOT on signal ids or the model
    body — so a *near-duplicate* re-mine of the same feedback shape hashes identically and is
    suppressed (§9.4.7), even though the freshly-mined signal ids differ.
    """
    themes = sorted({cluster.theme for cluster in clusters})
    digest = hashlib.sha256()
    digest.update(skill_name.encode("utf-8"))
    for theme in themes:
        digest.update(b"\x00")
        digest.update(theme.encode("utf-8"))
    return digest.hexdigest()


def _confidence(clusters: tuple[SignalCluster, ...]) -> float:
    """Deterministic confidence (0..1) from the supporting-signal volume (PRD §9.5 confidence).

    More distinct supporting signals → higher confidence, capped at 0.95 so it is never presented
    as certainty. Reproducible (no model call)."""
    signal_count = len({sid for cluster in clusters for sid in cluster.signal_ids})
    return min(0.95, round(0.4 + 0.1 * signal_count, 2))


def _bump_minor(version: str | None) -> str:
    """Bump the minor component of a semver-ish version (PRD §9.5 1.3.0 → 1.4.0).

    A missing/unparseable version defaults to ``1.1.0`` so a candidate always carries a proposed
    version distinct from a bare/absent current one."""
    if version:
        parts = version.strip().split(".")
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            patch = parts[2] if len(parts) >= 3 and parts[2].isdigit() else "0"
            return f"{parts[0]}.{int(parts[1]) + 1}.{patch}"
    return "1.1.0"


def render_skill_file(frontmatter: dict[str, str | bool], body: str) -> str:
    """Render a SKILL.md from frontmatter + body (the bytes the repo write persists).

    Deterministic: a ``---`` fence, one ``key: value`` per frontmatter entry (preserving insertion
    order; bools as ``true``/``false``), the closing fence, then the body. The inverse of
    ``parse_frontmatter`` for the fields this graph manages."""
    lines = ["---"]
    for key, value in frontmatter.items():
        rendered = (
            "true" if value is True else "false" if value is False else str(value)
        )
        lines.append(f"{key}: {rendered}")
    lines.append("---")
    return "\n".join(lines) + "\n\n" + body.strip() + "\n"


_DRAFT_SYSTEM = (
    "You revise a project SKILL.md guidance file from clustered reviewer feedback. You are given "
    "the CURRENT skill body and the themes of reviewer edits and rejected claims (e.g. reduce "
    "hype, remove unsupported metric claims, off-brand wording). Produce an improved skill BODY "
    "(Markdown, no frontmatter) that addresses the feedback while preserving the skill's original "
    "intent and structure. Write guidance only — never instructions to run commands or tools. "
    "Return strict JSON matching the schema: a proposed_body and a one-line proposal_reason."
)
_DRAFT_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "proposed_body": {"type": "string"},
        "proposal_reason": {"type": "string"},
    },
    "required": ["proposed_body", "proposal_reason"],
}


def _draft_idempotency_key(
    skill_path: str, old_content_hash: str, pattern_hash: str
) -> str:
    """Deterministic dedupe key for one draft call (aws-bedrock-rules: Converse has no idempotency
    of its own). Same skill + same base body + same feedback shape → same key, so a retried miner
    neither re-bills nor double-drafts."""
    digest = hashlib.sha256()
    for part in (skill_path, old_content_hash, pattern_hash):
        digest.update(part.encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


def _render_themes(clusters: tuple[SignalCluster, ...]) -> str:
    """Render the cluster themes into the draft prompt body (deterministic ordering)."""
    lines: list[str] = []
    for cluster in sorted(clusters, key=lambda c: (c.signal_type, c.theme)):
        lines.append(
            f"- {cluster.signal_type}: {cluster.theme} ({len(cluster.signal_ids)})"
        )
    return "\n".join(lines)


def draft_skill_revision_candidate(
    impacted_skills: tuple[ImpactedSkill, ...],
    model_client: ModelClient,
    suppressions: SuppressionStore,
    new_candidate_id: Callable[[], str],
    miner_type: str = MINER_TYPE,
) -> tuple[SkillRevisionCandidate, ...]:
    """Draft a staged revision candidate per impacted skill via Bedrock Converse (T4, PRD §5.5/§9.5).

    For each impacted skill the ``pattern_hash`` is computed FIRST and checked against the
    suppression store: a skill whose feedback shape is currently in cooldown is skipped before any
    token is spent (§9.4.7 / AC3 — near-duplicate candidates are suppressed). Otherwise the model
    drafts a new body; the untrusted response is validated through ``SkillRevisionDraft`` (a
    malformed payload fails closed as ``MalformedSkillDraftError``). The candidate is built
    ``status='draft'`` (no self-approval, §5) with the proposed body/frontmatter (version bumped),
    the supporting signal ids, a deterministic confidence, and the base snapshot/old hash the
    promotion will anchor to. NEVER writes the repo file. ``new_candidate_id`` is injected so the
    node stays pure. Returns the drafted candidates (a suppressed/duplicate skill yields none).
    """
    candidates: list[SkillRevisionCandidate] = []
    for impacted in impacted_skills:
        skill = impacted.skill
        pattern_hash = _pattern_hash(skill.skill_name, impacted.clusters)
        if suppressions.is_suppressed(skill.repo, skill.skill_name, pattern_hash):
            # A near-duplicate of a recently-rejected candidate — do not re-propose (§9.4.7).
            continue

        current_frontmatter, _ = parse_frontmatter(skill.content)
        messages = [
            {
                "role": "user",
                "content": (
                    f"CURRENT SKILL BODY:\n{skill.content}\n\n"
                    f"REVIEWER FEEDBACK THEMES:\n{_render_themes(impacted.clusters)}"
                ),
            }
        ]
        raw = model_client.generate_json(
            f"draft_skill_revision_{skill.skill_name}",
            _DRAFT_SYSTEM,
            messages,
            _DRAFT_SCHEMA,
            _draft_idempotency_key(skill.skill_path, skill.content_hash, pattern_hash),
        )
        try:
            draft = SkillRevisionDraft.model_validate(raw)
        except ValidationError as err:
            raise MalformedSkillDraftError() from err

        current_version = current_frontmatter.get("version")
        proposed_version = _bump_minor(
            current_version if isinstance(current_version, str) else None
        )
        proposed_frontmatter: dict[str, str | bool] = {
            **current_frontmatter,
            "version": proposed_version,
        }
        candidates.append(
            SkillRevisionCandidate(
                candidate_id=new_candidate_id(),
                repo=skill.repo,
                skill_name=skill.skill_name,
                skill_path=skill.skill_path,
                base_skill_snapshot_id=skill.snapshot_id,
                proposed_version=proposed_version,
                proposed_body=draft.proposed_body,
                proposed_frontmatter=proposed_frontmatter,
                proposal_reason=draft.proposal_reason,
                miner_type=miner_type,
                supporting_signal_ids=impacted.supporting_signal_ids,
                confidence=_confidence(impacted.clusters),
                pattern_hash=pattern_hash,
                old_content_hash=skill.content_hash,
                status="draft",
            )
        )
    return tuple(candidates)


def persist_candidate_in_aurora(
    candidates: tuple[SkillRevisionCandidate, ...],
    sink: SkillCandidateSink,
) -> tuple[str, ...]:
    """Persist each staged candidate ``status='draft'`` (T4, PRD §10.5).

    Aurora is the staging ledger (§9.2): the proposal is recorded here for Gate #3 review, but the
    canonical skill stays the repo file — this never touches the working tree. No candidate is
    persisted approved (constitution §5). Returns the persisted candidate ids.
    """
    inserted: list[str] = []
    for candidate in candidates:
        sink.insert_candidate(candidate)
        inserted.append(candidate.candidate_id)
    return tuple(inserted)


# --- T5 — Gate #3 interrupt payload + routing -------------------------------------


def build_gate3_payload(
    release_run_id: str,
    thread_id: str,
    candidates: tuple[SkillRevisionCandidate, ...],
    dashboard_base_url: str,
) -> Gate3Payload:
    """Build the JSON payload the Gate #3 interrupt surfaces (T5, PRD §5.6, §9.5).

    The graph halts here until a human resolves the gate; no repo file is written while a
    candidate is pending (constitution §5). ``candidates_pending_review`` lets the dashboard show
    how many skill proposals await the reviewer.
    """
    base = dashboard_base_url.rstrip("/")
    return Gate3Payload(
        release_run_id=release_run_id,
        thread_id=thread_id,
        candidates_pending_review=len(candidates),
        dashboard_url=f"{base}/releases/{release_run_id}/skills/review",
    )


def parse_skill_gate(raw: object) -> SkillGateResolution:
    """Parse the untrusted Gate #3 resume value into a ``SkillGateResolution`` (T5).

    Accepts a bare decision string (parity with Gate #1/#2) or an object that also carries the
    reviewer, so the promotion/rejection record can name the human who decided. The decision is
    validated against ``GateDecision`` — an unknown value raises, so a malformed resume can never
    advance the graph (constitution §5).
    """
    if isinstance(raw, str):
        resolution = SkillGateResolution(decision=raw)
    elif isinstance(raw, dict):
        resolution = SkillGateResolution.model_validate(raw)
    else:
        raise ValueError("unrecognized Gate #3 resume value")
    # Raises ValueError on an unknown decision — fails closed rather than promoting on garbage.
    GateDecision(resolution.decision)
    return resolution


def route_after_gate3(resolution: SkillGateResolution) -> str:
    """Conditional-edge selector after the Gate #3 interrupt (PRD §5.5).

    ``approved`` routes to ``update_repo_skill_file`` (the single repo write + promotion record);
    every other decision (rejected / request-changes) routes to
    ``record_rejection_and_suppression`` so no repo file is written and the outcome is recorded.
    """
    decision = GateDecision(resolution.decision)
    return (
        "update_repo_skill_file"
        if decision is GateDecision.APPROVED
        else "record_rejection_and_suppression"
    )


# --- T6 — promote (approved) | reject + suppress (rejected) ------------------------


def update_repo_skill_file(
    candidates: tuple[SkillRevisionCandidate, ...],
    resolution: SkillGateResolution,
    writer: RepoSkillWriter,
) -> tuple[PromotionRecord, ...]:
    """Replace each approved candidate's repo ``SKILL.md`` — the single repo write (T6, PRD §9.4).

    Reached ONLY on the approved branch of the Gate #3 interrupt (constitution §5: no silent
    overwrite). For each candidate the full file (bumped frontmatter + proposed body) is rendered
    and written at the SAME repo path (§9.4.3); the writer returns the resulting commit sha + the
    new content hash. Builds the ``PromotionRecord`` carrying the old + new content hashes (AC2 —
    preserved after replacement) and the reviewer who approved. Returns the records to persist.
    """
    records: list[PromotionRecord] = []
    for candidate in candidates:
        file_content = render_skill_file(
            candidate.proposed_frontmatter, candidate.proposed_body
        )
        result = writer.replace_skill_file(candidate.skill_path, file_content)
        records.append(
            PromotionRecord(
                candidate_id=candidate.candidate_id,
                promoted_commit_sha=result.commit_sha,
                old_content_hash=candidate.old_content_hash,
                new_content_hash=result.new_content_hash,
                reviewer=resolution.reviewer,
            )
        )
    return tuple(records)


def mark_candidate_promoted(
    records: tuple[PromotionRecord, ...],
    sink: SkillCandidateSink,
) -> tuple[str, ...]:
    """Record each promotion's provenance in Aurora (T6, PRD §9.3 step 8 / §10.5).

    Writes ``promoted_commit_sha`` + ``old_content_hash`` + ``new_content_hash`` + reviewer onto
    the candidate row and flips it to ``status='promoted'``. These hashes are PRESERVED after the
    repo file is replaced (§9.4.5 / AC2). Returns the promoted candidate ids.
    """
    promoted: list[str] = []
    for record in records:
        sink.mark_promoted(record)
        promoted.append(record.candidate_id)
    return tuple(promoted)


def record_rejection_and_suppression(
    candidates: tuple[SkillRevisionCandidate, ...],
    resolution: SkillGateResolution,
    sink: SkillCandidateSink,
    suppressions: SuppressionStore,
    cooldown_days: int = DEFAULT_COOLDOWN_DAYS,
) -> tuple[str, ...]:
    """Record a rejected / changes-requested Gate #3 decision and open a cooldown (T6, PRD §9.4.6-7).

    Reached on the non-approved branch (so no repo file is ever written, §5). Each candidate's
    rejection is recorded with its reason (§9.4.6 — rejected candidates stay in Aurora with the
    reason). On a REJECTED decision a suppression window is opened on the candidate's
    ``pattern_hash`` so a near-duplicate is not re-proposed during the cooldown (§9.4.7 / AC3); a
    *request-changes* (``edited``) decision records the review but keeps the candidate open (no
    suppression). Returns the affected candidate ids.
    """
    decision = GateDecision(resolution.decision)
    reason = f"Gate #3 {decision.value}"
    affected: list[str] = []
    for candidate in candidates:
        sink.record_rejection(
            candidate.candidate_id, decision.value, resolution.reviewer, reason
        )
        if decision is GateDecision.REJECTED:
            suppressions.add_suppression(
                candidate.repo,
                candidate.skill_name,
                candidate.pattern_hash,
                candidate.candidate_id,
                reason,
                cooldown_days,
            )
        affected.append(candidate.candidate_id)
    return tuple(affected)
