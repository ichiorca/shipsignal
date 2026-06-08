"""T1 (spec 010) — retention policy + TTL sweep over the in-memory store.

Exercises the public surface the privacy CLI invokes (``sweep_expired_evidence`` and the
``RetentionPolicy``), not a private helper (anti-pattern #4). The fake records every deleted
S3 key so the test proves storage limitation clears BOTH the Aurora row and the S3 blob.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from release_worker.retention import (
    DEFAULT_POLICY,
    DEFAULT_RETENTION_DAYS,
    ExpiredEvidence,
    InMemoryExpiredEvidenceStore,
    LawfulBasis,
    RetentionPolicy,
    sweep_expired_evidence,
)

_NOW = datetime(2026, 6, 8, 12, 0, tzinfo=UTC)


def test_default_policy_matches_the_ddl_window_and_basis() -> None:
    """The code policy must agree with migration 0009's column defaults."""
    assert DEFAULT_POLICY.retention_days == DEFAULT_RETENTION_DAYS == 180
    assert DEFAULT_POLICY.lawful_basis is LawfulBasis.LEGITIMATE_INTERESTS
    assert DEFAULT_POLICY.processing_purpose == "release_content_generation"


def test_expiry_is_measured_from_created_at_not_now() -> None:
    created = datetime(2026, 1, 1, tzinfo=UTC)
    policy = RetentionPolicy(retention_days=30)

    assert policy.expiry_for(created) == created + timedelta(days=30)


def test_sweep_deletes_expired_rows_and_their_s3_blobs() -> None:
    store = InMemoryExpiredEvidenceStore()
    expired = ExpiredEvidence(
        evidence_id="11111111-1111-4111-8111-111111111111",
        release_run_id="22222222-2222-4222-8222-222222222222",
        raw_excerpt_s3_uri="s3://evidence-bucket/evidence/run/ev.txt",
    )
    fresh = ExpiredEvidence(
        evidence_id="33333333-3333-4333-8333-333333333333",
        release_run_id="22222222-2222-4222-8222-222222222222",
        raw_excerpt_s3_uri="s3://evidence-bucket/evidence/run/keep.txt",
    )
    store.seed(expired, retention_expires_at=_NOW - timedelta(days=1))  # past → swept
    store.seed(fresh, retention_expires_at=_NOW + timedelta(days=1))  # future → kept

    report = sweep_expired_evidence(store, now=_NOW)

    assert report.rows_deleted == 1
    assert report.objects_deleted == 1
    assert report.evidence_ids == (expired.evidence_id,)
    # Both stores cleared for the expired row; the fresh row's blob is untouched.
    assert store.deleted_objects == ["s3://evidence-bucket/evidence/run/ev.txt"]
    # The fresh row survives the sweep.
    assert store.list_expired(_NOW) == ()
    assert store.list_expired(_NOW + timedelta(days=2)) == (fresh,)


def test_sweep_is_idempotent_when_nothing_expired() -> None:
    store = InMemoryExpiredEvidenceStore()
    store.seed(
        ExpiredEvidence(
            evidence_id="44444444-4444-4444-8444-444444444444",
            release_run_id="55555555-5555-4555-8555-555555555555",
        ),
        retention_expires_at=_NOW + timedelta(days=10),
    )

    report = sweep_expired_evidence(store, now=_NOW)

    assert report.rows_deleted == 0
    assert report.objects_deleted == 0
    assert store.deleted_objects == []


def test_sweep_deletes_row_without_blob_but_reports_no_object() -> None:
    """A row whose S3 uri is null still has its Aurora row swept; no object is counted."""
    store = InMemoryExpiredEvidenceStore()
    store.seed(
        ExpiredEvidence(
            evidence_id="66666666-6666-4666-8666-666666666666",
            release_run_id="77777777-7777-4777-8777-777777777777",
            raw_excerpt_s3_uri=None,
        ),
        retention_expires_at=_NOW - timedelta(days=5),
    )

    report = sweep_expired_evidence(store, now=_NOW)

    assert report.rows_deleted == 1
    assert report.objects_deleted == 0
    assert store.deleted_objects == []
