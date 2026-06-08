"""T1/T2/T3 (spec 010) — runtime Aurora + S3 adapters for the data-subject-rights ops.

P4 (Storage) + aurora/s3 rules: the pure rights logic (``retention``/``erasure``/
``access_export``) depends only on narrow Protocols; these psycopg + boto3 implementations
are the durable side, imported only by ``release_worker.privacy`` (the CLI entry point) so the
unit gate never needs a DB, an S3 bucket, or network. Every statement is parameterized; the
DSN is TLS-required from env (``connect_from_env``); S3 access uses the ambient role creds.

Erasure spans two private buckets — the evidence bucket (``evidence/<run>/`` blobs) and the
media bucket (``media/<run>/`` blobs); ``list_objects``/``delete_objects`` route by prefix so
the bucket-agnostic erasure logic stays unchanged.
"""

from __future__ import annotations

import json
from datetime import datetime

import psycopg

from release_worker.access_export import SubjectDataReader, SubjectDataRecord
from release_worker.erasure import ErasureReport, ErasureStore
from release_worker.retention import ExpiredEvidence, ExpiredEvidenceStore


def _parse_s3_uri(uri: str) -> tuple[str, str]:
    """Split ``s3://bucket/key`` into ``(bucket, key)``; raise on a non-S3 uri."""
    if not uri.startswith("s3://"):
        raise ValueError("not an s3:// uri")
    bucket, _, key = uri[len("s3://") :].partition("/")
    if not bucket or not key:
        raise ValueError("malformed s3:// uri")
    return bucket, key


class AuroraS3ExpiredEvidenceStore(ExpiredEvidenceStore):
    """``ExpiredEvidenceStore`` over Aurora ``evidence_items`` + the S3 evidence bucket."""

    def __init__(self, conn: psycopg.Connection, s3_client: object) -> None:
        self._conn = conn
        self._s3 = s3_client

    def list_expired(self, now: datetime) -> tuple[ExpiredEvidence, ...]:
        with self._conn.cursor() as cur:
            cur.execute(
                """SELECT id, release_run_id, raw_excerpt_s3_uri
                       FROM evidence_items
                      WHERE retention_expires_at < %s""",
                (now,),
            )
            rows = cur.fetchall()
        return tuple(
            ExpiredEvidence(
                evidence_id=str(row[0]),
                release_run_id=str(row[1]),
                raw_excerpt_s3_uri=row[2],
            )
            for row in rows
        )

    def delete_evidence(self, item: ExpiredEvidence) -> bool:
        deleted_object = False
        if item.raw_excerpt_s3_uri:
            bucket, key = _parse_s3_uri(item.raw_excerpt_s3_uri)
            self._s3.delete_object(Bucket=bucket, Key=key)  # type: ignore[attr-defined]
            deleted_object = True
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM evidence_items WHERE id = %s", (item.evidence_id,))
        return deleted_object


class AuroraS3ErasureStore(ErasureStore):
    """``ErasureStore`` over Aurora (``release_runs`` CASCADE + ``erasure_audit``) and the
    two private buckets (evidence + media)."""

    def __init__(
        self,
        conn: psycopg.Connection,
        s3_client: object,
        *,
        evidence_bucket: str,
        media_bucket: str,
    ) -> None:
        self._conn = conn
        self._s3 = s3_client
        self._buckets = {"evidence/": evidence_bucket, "media/": media_bucket}

    def _bucket_for(self, prefix: str) -> str:
        for root, bucket in self._buckets.items():
            if prefix.startswith(root):
                return bucket
        raise ValueError(f"no bucket configured for prefix {prefix!r}")

    def delete_run_rows(self, release_run_id: str) -> int:
        # Deleting the release_runs row CASCADEs to evidence/features/claims/artifacts/media/
        # learning_signals (FK chain, migrations 0003-0008). rowcount is 1, or 0 if already gone.
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM release_runs WHERE id = %s", (release_run_id,))
            return cur.rowcount

    def list_objects(self, prefix: str) -> tuple[str, ...]:
        bucket = self._bucket_for(prefix)
        keys: list[str] = []
        token: str | None = None
        while True:
            kwargs: dict[str, object] = {"Bucket": bucket, "Prefix": prefix}
            if token is not None:
                kwargs["ContinuationToken"] = token
            resp = self._s3.list_objects_v2(**kwargs)  # type: ignore[attr-defined]
            keys.extend(obj["Key"] for obj in resp.get("Contents", []))
            if not resp.get("IsTruncated"):
                break
            token = resp.get("NextContinuationToken")
        return tuple(keys)

    def delete_objects(self, keys: tuple[str, ...]) -> int:
        deleted = 0
        # keys all share one run's prefix root, so they live in a single bucket.
        for key in keys:
            bucket = self._bucket_for(key)
            self._s3.delete_object(Bucket=bucket, Key=key)  # type: ignore[attr-defined]
            deleted += 1
        return deleted

    def record_audit(self, report: ErasureReport) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """INSERT INTO erasure_audit (
                       release_run_id, requested_by, reason,
                       rows_deleted, objects_deleted, erased_at
                   ) VALUES (%s, %s, %s, %s, %s, %s)""",
                (
                    report.release_run_id,
                    report.requested_by,
                    report.reason,
                    report.rows_deleted,
                    report.objects_deleted,
                    report.erased_at,
                ),
            )


class AuroraSubjectDataReader(SubjectDataReader):
    """``SubjectDataReader`` over Aurora ``evidence_items``, scoped to one run."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def read_personal_data(self, release_run_id: str) -> tuple[SubjectDataRecord, ...]:
        with self._conn.cursor() as cur:
            cur.execute(
                """SELECT id, evidence_type, source, source_url, file_path,
                          redacted_excerpt, lawful_basis, processing_purpose, risk_flags
                       FROM evidence_items
                      WHERE release_run_id = %s
                      ORDER BY created_at""",
                (release_run_id,),
            )
            rows = cur.fetchall()
        return tuple(
            SubjectDataRecord(
                evidence_id=str(row[0]),
                evidence_type=row[1],
                source=row[2],
                source_url=row[3],
                file_path=row[4],
                redacted_excerpt=row[5] or "",
                lawful_basis=row[6],
                processing_purpose=row[7],
                risk_flags=tuple(_coerce_flags(row[8])),
            )
            for row in rows
        )


def _coerce_flags(value: object) -> list[str]:
    """Coerce a jsonb risk_flags column (list, JSON string, or None) to ``list[str]``."""
    if value is None:
        return []
    if isinstance(value, str):
        parsed = json.loads(value)
        return [str(flag) for flag in parsed]
    if isinstance(value, list):
        return [str(flag) for flag in value]
    return []
