"""T2/T3/T4/T6 (spec 004) — the feature-manifest nodes of release_intelligence_graph
(PRD §5.2 cluster → score → persist → Gate #1 → review-decision).

Each node is a pure function of ``(inputs, port)`` — no langgraph/psycopg/boto3 import —
so it is unit-tested through the exact surface the graph invokes (anti-pattern #4). The
constitution's load-bearing rules are enforced *structurally*:

* P5 / §5 — prompts contain only redacted evidence: ``cluster_features_with_bedrock``
  reads ``EvidenceRecord`` (which has ``redacted_excerpt`` and **no** raw field), so the
  prompt it builds cannot carry un-redacted text.
* P5 — model output is untrusted: the Bedrock response is validated through
  ``ClusterResponse`` and every ``evidence_id`` is filtered to the set actually sent, so
  a hallucinated id can't create a dangling link.
* §5 — no self-approval: persisted features are always ``pending_review``; only
  ``persist_review_decision``, driven by a recorded human decision, changes the status.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable

from pydantic import ValidationError

from release_worker.evidence_models import EvidenceRecord
from release_worker.feature_models import (
    CandidateFeature,
    ClusterResponse,
    FeatureRecord,
    FeatureScores,
    Gate1Payload,
    GateDecision,
    MalformedModelOutputError,
    ScoredFeature,
)
from release_worker.feature_ports import FeatureSink
from release_worker.model_client import ModelClient

# --- T2 — clustering via Bedrock Converse -----------------------------------------

_CLUSTER_TASK = "cluster_features"
_CLUSTER_SYSTEM = (
    "You cluster redacted release evidence into candidate product features. "
    "Group related evidence items into features a reviewer could ship as marketing or "
    "demo content. Use ONLY the supplied redacted evidence; never invent capabilities. "
    "For each feature cite the evidence_id values it is built from. Return strict JSON "
    "matching the provided schema."
)
# The output contract handed to Converse (and to the Guardrail-attached adapter). Kept
# alongside the Pydantic model that re-validates the response (defence in depth).
_CLUSTER_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "features": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "summary_internal": {"type": "string"},
                    "user_value": {"type": "string"},
                    "audiences": {"type": "array", "items": {"type": "string"}},
                    "change_type": {"type": "string"},
                    "surface_area": {"type": "array", "items": {"type": "string"}},
                    "evidence_ids": {"type": "array", "items": {"type": "string"}},
                    "demo_steps_draft": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["title", "evidence_ids"],
            },
        }
    },
    "required": ["features"],
}


def _render_evidence(evidence: tuple[EvidenceRecord, ...]) -> str:
    """Build the (redacted-only) user prompt body, one block per evidence item.

    Deterministic ordering (by evidence_id) so the idempotency hash is stable across
    runs over the same evidence set."""
    blocks = []
    for item in sorted(evidence, key=lambda e: e.evidence_id):
        header = f"[{item.evidence_id}] type={item.evidence_type} file={item.file_path or '-'}"
        blocks.append(f"{header}\n{item.redacted_excerpt}")
    return "\n\n".join(blocks)


def _idempotency_key(release_run_id: str, evidence: tuple[EvidenceRecord, ...]) -> str:
    """Deterministic dedupe key for the clustering call (aws-bedrock-rules: Converse has
    no idempotency of its own). Same run + same evidence set → same key, so a retried
    job does not double-bill or double-cluster."""
    digest = hashlib.sha256()
    digest.update(release_run_id.encode("utf-8"))
    for item in sorted(evidence, key=lambda e: e.evidence_id):
        digest.update(b"\x00")
        digest.update(item.evidence_id.encode("utf-8"))
        digest.update(item.redacted_excerpt.encode("utf-8"))
    return digest.hexdigest()


def cluster_features_with_bedrock(
    release_run_id: str,
    evidence: tuple[EvidenceRecord, ...],
    model_client: ModelClient,
) -> tuple[CandidateFeature, ...]:
    """Cluster redacted evidence into candidate features via Bedrock Converse (T2).

    The prompt is built only from ``redacted_excerpt`` (the type carries no raw field, so
    "prompts contain only redacted evidence" is enforced by construction, not a check).
    The response is validated through ``ClusterResponse`` (untrusted model output, AC4)
    and each feature's ``evidence_ids`` is filtered to the ids actually sent; a feature
    left with zero real evidence links is dropped (AC: each persisted feature links to
    >=1 evidence item).
    """
    if not evidence:
        return ()

    known_ids = {item.evidence_id for item in evidence}
    messages = [{"role": "user", "content": _render_evidence(evidence)}]
    raw = model_client.generate_json(
        _CLUSTER_TASK,
        _CLUSTER_SYSTEM,
        messages,
        _CLUSTER_SCHEMA,
        _idempotency_key(release_run_id, evidence),
    )

    try:
        response = ClusterResponse.model_validate(raw)
    except ValidationError as err:
        raise MalformedModelOutputError() from err

    out: list[CandidateFeature] = []
    for feature in response.features:
        valid_ids = tuple(eid for eid in feature.evidence_ids if eid in known_ids)
        if not valid_ids:
            continue  # no real evidence → cannot be persisted with a link; drop it
        out.append(feature.model_copy(update={"evidence_ids": valid_ids}))
    return tuple(out)


# --- T3 — deterministic scoring ---------------------------------------------------

# Evidence types that demo well on screen (PRD §6.2): a feature backed by these is more
# demoable. Used to derive demoability deterministically instead of asking the model.
_DEMOABLE_TYPES = frozenset({"ui_string_change", "route_change", "ui_string", "route"})


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def _launch_risk(confidence: float) -> str:
    """Lower confidence ⇒ higher launch risk (PRD §7 launch_risk)."""
    if confidence >= 0.75:
        return "low"
    if confidence >= 0.5:
        return "medium"
    return "high"


def score_features(
    candidates: tuple[CandidateFeature, ...],
    evidence: tuple[EvidenceRecord, ...],
) -> tuple[ScoredFeature, ...]:
    """Compute marketability/demoability/confidence for each candidate (T3, PRD §7).

    Deterministic and reproducible — derived from the linked evidence's composition and
    the candidate's own narrative fields, never from a second model call (constitution §6
    cost/latency). Confidence is the mean of the linked evidence's own confidences.
    """
    by_id = {item.evidence_id: item for item in evidence}
    scored: list[ScoredFeature] = []
    for candidate in candidates:
        linked = [by_id[eid] for eid in candidate.evidence_ids if eid in by_id]
        if not linked:
            continue  # mirror clustering's >=1-link invariant defensively

        confidences = [e.confidence for e in linked if e.confidence is not None]
        confidence = _clamp(sum(confidences) / len(confidences) if confidences else 0.5)

        demoable = sum(1 for e in linked if e.evidence_type in _DEMOABLE_TYPES)
        demoability = _clamp(
            0.3
            + 0.5 * (demoable / len(linked))
            + (0.2 if candidate.demo_steps_draft else 0.0)
        )

        marketability = _clamp(
            0.2
            + 0.2 * (1.0 if candidate.user_value else 0.0)
            + 0.1 * min(len(candidate.audiences), 3)
            + (0.2 if candidate.change_type == "new_feature" else 0.0)
            + 0.1 * min(len(linked), 3)
        )

        scored.append(
            ScoredFeature(
                candidate=candidate,
                scores=FeatureScores(
                    marketability_score=marketability,
                    demoability_score=demoability,
                    confidence=confidence,
                    launch_risk=_launch_risk(confidence),
                ),
            )
        )
    return tuple(scored)


# --- T3 — persist the feature manifest --------------------------------------------


def _relevance_score(evidence: EvidenceRecord) -> float:
    """Per-link relevance for feature_evidence_links: the evidence's own confidence
    (direct-provenance items default to 1.0 when unscored)."""
    return _clamp(evidence.confidence if evidence.confidence is not None else 1.0)


def persist_feature_manifest(
    release_run_id: str,
    scored: tuple[ScoredFeature, ...],
    evidence: tuple[EvidenceRecord, ...],
    sink: FeatureSink,
    new_feature_id: Callable[[], str],
) -> tuple[FeatureRecord, ...]:
    """Persist feature_clusters rows + feature_evidence_links (T3, PRD §10.2).

    Every feature is written ``pending_review`` (no self-approval, §5) and gets one link
    row per real evidence id (relevance_score = the evidence's confidence). A feature
    with no resolvable evidence is skipped so the AC ">=1 evidence link" always holds.
    ``new_feature_id`` is injected (not ``uuid4`` inline) so the node stays pure and a
    test can assert deterministic ids.
    """
    by_id = {item.evidence_id: item for item in evidence}
    records: list[FeatureRecord] = []
    for sf in scored:
        links = [(eid, by_id[eid]) for eid in sf.candidate.evidence_ids if eid in by_id]
        if not links:
            continue

        feature_id = new_feature_id()
        record = FeatureRecord(
            feature_id=feature_id,
            release_run_id=release_run_id,
            title=sf.candidate.title,
            summary_internal=sf.candidate.summary_internal,
            user_value=sf.candidate.user_value,
            audiences=sf.candidate.audiences,
            change_type=sf.candidate.change_type,
            surface_area=sf.candidate.surface_area,
            marketability_score=sf.scores.marketability_score,
            demoability_score=sf.scores.demoability_score,
            confidence=sf.scores.confidence,
            launch_risk=sf.scores.launch_risk,
            evidence_ids=tuple(eid for eid, _ in links),
            status="pending_review",
        )
        sink.insert_feature(record)
        for evidence_item_id, evidence_item in links:
            sink.link_evidence(
                feature_id, evidence_item_id, _relevance_score(evidence_item)
            )
        records.append(record)
    return tuple(records)


# --- T4 — Gate #1 interrupt payload + routing -------------------------------------


def build_gate1_payload(
    release_run_id: str,
    thread_id: str,
    features_pending_review: int,
    dashboard_base_url: str,
) -> Gate1Payload:
    """Build the JSON payload the Gate #1 interrupt surfaces (PRD §5.6 example).

    The graph halts here until a human resolves the gate; nothing downstream
    (content generation) runs while the manifest is pending (the AC: no self-approval
    path, the graph blocks at Gate #1)."""
    base = dashboard_base_url.rstrip("/")
    return Gate1Payload(
        release_run_id=release_run_id,
        thread_id=thread_id,
        features_pending_review=features_pending_review,
        dashboard_url=f"{base}/releases/{release_run_id}/review",
    )


def route_after_gate1(decision: GateDecision) -> str:
    """Conditional-edge selector after the Gate #1 interrupt (PRD §5.2).

    ``approved`` ends the graph (the manifest is ready for content generation);
    ``rejected``/``edited`` route to ``persist_review_decision`` so those features are
    recorded and do **not** flow downstream."""
    return (
        "approved" if decision is GateDecision.APPROVED else "persist_review_decision"
    )


# --- T6 — persist the review decision ---------------------------------------------


def persist_review_decision(
    decision: GateDecision,
    features: tuple[FeatureRecord, ...],
    sink: FeatureSink,
    reviewer_notes: str | None = None,
) -> tuple[str, ...]:
    """Apply a recorded Gate #1 decision to the run's features (T6, PRD §5.2).

    Sets each feature's status to the decision value (``approved`` /``rejected``
    /``edited``). Only ``approved`` features are loaded by the content-generation graph
    in spec 005, so ``rejected``/``edited`` features are persisted but never flow
    downstream. Returns the affected feature ids (for the caller's audit/log).

    This node is the graph-side persistence; the human *decision record* (an ``approvals``
    row with reviewer + edited_payload_json) is written by the dashboard API at the gate
    (AC2). Both are idempotent: re-applying the same decision is a no-op-equivalent write.
    """
    affected: list[str] = []
    for feature in features:
        sink.update_status(feature.feature_id, decision.value, reviewer_notes)
        affected.append(feature.feature_id)
    return tuple(affected)
