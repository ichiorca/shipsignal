"""T2/T3/T6 (spec 004) — runtime ``FeatureSink`` + redacted-evidence reader over Aurora.

P4 (Storage): feature_clusters + feature_evidence_links rows go to Aurora; nothing here
touches S3 (features are structured, not blobs). aurora-rules: every statement is
parameterised; the connection comes from the shared short-lived job connection.

constitution §5 — the clustering prompt may contain ONLY redacted evidence. The reader
selects ``redacted_excerpt`` (never a raw column — there is none) and the S3 key, never
the raw text, so what feeds Bedrock is redacted by construction. Imported only by
``__main__`` at runtime (needs psycopg).
"""

from __future__ import annotations

import psycopg

from release_worker.evidence_models import EvidenceRecord
from release_worker.feature_models import FeatureRecord


class AuroraRedactedEvidenceReader:
    """Read a run's redacted evidence back for clustering (PRD §11 retrieval source)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def list_redacted_evidence(self, release_run_id: str) -> tuple[EvidenceRecord, ...]:
        """Return the run's evidence as ``EvidenceRecord``s (redacted content only).

        Ordered by id for a deterministic clustering prompt + idempotency key.
        """
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, evidence_type, source, source_url, repo, file_path,
                       symbol_name, raw_excerpt_s3_uri, redacted_excerpt, confidence,
                       risk_flags, metadata_json
                  FROM evidence_items
                 WHERE release_run_id = %s
                 ORDER BY id
                """,
                (release_run_id,),
            )
            rows = cur.fetchall()

        records: list[EvidenceRecord] = []
        for row in rows:
            (
                evidence_id,
                evidence_type,
                source,
                source_url,
                repo,
                file_path,
                symbol_name,
                s3_uri,
                redacted_excerpt,
                confidence,
                risk_flags,
                metadata_json,
            ) = row
            records.append(
                EvidenceRecord(
                    evidence_id=str(evidence_id),
                    release_run_id=release_run_id,
                    evidence_type=evidence_type,
                    source=source,
                    source_url=source_url,
                    repo=repo,
                    file_path=file_path,
                    symbol_name=symbol_name,
                    raw_excerpt_s3_uri=s3_uri or "s3://unknown/unknown",
                    redacted_excerpt=redacted_excerpt or "",
                    risk_flags=tuple(risk_flags or ()),
                    confidence=float(confidence) if confidence is not None else None,
                    metadata=_as_str_int_map(metadata_json),
                )
            )
        return tuple(records)


def _as_str_int_map(value: object) -> dict[str, str | int]:
    """Coerce a jsonb metadata column into the model's ``dict[str, str | int]`` shape,
    dropping anything that isn't a str/int value (defensive: data is untrusted-at-rest)."""
    if not isinstance(value, dict):
        return {}
    out: dict[str, str | int] = {}
    for key, val in value.items():
        if isinstance(key, str) and isinstance(val, str | int):
            out[key] = val
    return out


class AuroraFeatureSink:
    """Persist the feature manifest + apply Gate #1 status decisions to Aurora."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def insert_feature(self, record: FeatureRecord) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO feature_clusters (
                    id, release_run_id, title, summary_internal, user_value,
                    audiences, change_type, surface_area, marketability_score,
                    demoability_score, confidence, launch_risk, status
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    record.feature_id,
                    record.release_run_id,
                    record.title,
                    record.summary_internal,
                    record.user_value,
                    list(record.audiences),
                    record.change_type,
                    list(record.surface_area),
                    record.marketability_score,
                    record.demoability_score,
                    record.confidence,
                    record.launch_risk,
                    record.status,
                ),
            )

    def link_evidence(
        self, feature_id: str, evidence_item_id: str, relevance_score: float
    ) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO feature_evidence_links
                    (feature_id, evidence_item_id, relevance_score)
                VALUES (%s, %s, %s)
                ON CONFLICT (feature_id, evidence_item_id) DO NOTHING
                """,
                (feature_id, evidence_item_id, relevance_score),
            )

    def update_status(
        self, feature_id: str, status: str, reviewer_notes: str | None
    ) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                UPDATE feature_clusters
                   SET status = %s,
                       reviewer_notes = COALESCE(%s, reviewer_notes),
                       updated_at = now()
                 WHERE id = %s
                """,
                (status, reviewer_notes, feature_id),
            )
