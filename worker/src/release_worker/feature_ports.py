"""T3/T6 (spec 004) — the ``FeatureSink`` port the feature nodes persist through, plus
an in-memory fake.

P4 (Storage): the nodes never import psycopg directly; they depend on this narrow
Protocol. The durable implementation (``aurora_features.AuroraFeatureSink``) lives
in a runtime-only module imported by ``__main__``, so the unit gate exercises the node
logic against the fake here without a DB (mirrors the evidence-slice port split).
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from release_worker.evidence_models import EvidenceRecord
from release_worker.feature_models import FeatureRecord


@runtime_checkable
class RedactedEvidenceReader(Protocol):
    """Read a run's redacted evidence back for clustering (PRD §11 retrieval source).

    Returns ``EvidenceRecord``s whose only excerpt field is ``redacted_excerpt`` — there
    is no raw field — so what feeds the Bedrock prompt is redacted by construction (§5).
    ``AuroraRedactedEvidenceReader`` satisfies it at runtime."""

    def list_redacted_evidence(
        self, release_run_id: str
    ) -> tuple[EvidenceRecord, ...]: ...


@runtime_checkable
class FeatureSink(Protocol):
    """Persist the feature manifest: feature_clusters rows + feature_evidence_links, and
    apply Gate #1 review-decision status changes (PRD §10.2 / §5.6)."""

    def insert_feature(self, record: FeatureRecord) -> None:
        """Insert one feature_clusters row (status='pending_review')."""
        ...

    def link_evidence(
        self, feature_id: str, evidence_item_id: str, relevance_score: float
    ) -> None:
        """Insert one feature_evidence_links row."""
        ...

    def update_status(
        self, feature_id: str, status: str, reviewer_notes: str | None
    ) -> None:
        """Apply a reviewed status (approved/rejected/edited) to one feature."""
        ...


class InMemoryFeatureSink:
    """In-process ``FeatureSink``: records features, links, and status updates so tests
    can assert the manifest was persisted with >=1 evidence link per feature and that a
    rejected/edited feature's status was changed (it does not flow downstream)."""

    def __init__(self) -> None:
        self.features: list[FeatureRecord] = []
        # (feature_id, evidence_item_id, relevance_score)
        self.links: list[tuple[str, str, float]] = []
        # feature_id -> (status, reviewer_notes), latest write wins
        self.statuses: dict[str, tuple[str, str | None]] = {}

    def insert_feature(self, record: FeatureRecord) -> None:
        self.features.append(record)

    def link_evidence(
        self, feature_id: str, evidence_item_id: str, relevance_score: float
    ) -> None:
        self.links.append((feature_id, evidence_item_id, relevance_score))

    def update_status(
        self, feature_id: str, status: str, reviewer_notes: str | None
    ) -> None:
        self.statuses[feature_id] = (status, reviewer_notes)
