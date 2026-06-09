"""Integration: the worker's S3 writer against a REAL LocalStack S3.

Exercises the actual app class (``S3MediaStore``) — uploads an assembled-media blob and
reads the same bytes back through boto3, asserting the run-scoped key layout and the
server-side-encryption header the store sets (s3-rules). This is the *producer* half of
the evidence/media S3 seam; the TS ``s3Presign.integration.ts`` test is the *consumer*
half (presigned GET) of the same bucket.
"""

from __future__ import annotations

import os

import boto3
import pytest
from botocore.config import Config

from release_worker.media_models import AssembledMedia
from release_worker.s3_media_store import S3MediaStore


def _s3_client() -> object:
    endpoint = os.environ.get("AWS_ENDPOINT_URL")
    if not endpoint:
        pytest.skip("AWS_ENDPOINT_URL not set (LocalStack)")
    # Path-style is required for LocalStack: virtual-hosted addressing would resolve to
    # <bucket>.localhost:4566, which does not resolve on most hosts (notably Windows).
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        config=Config(s3={"addressing_style": "path"}),
    )


def test_media_store_uploads_and_reads_back(tmp_path) -> None:
    bucket = os.environ.get("MEDIA_BUCKET")
    if not bucket:
        pytest.skip("MEDIA_BUCKET not set")
    s3 = _s3_client()

    blob = b"\x00\x01\x02 fake assembled mp4 payload"
    local = tmp_path / "demo.mp4"
    local.write_bytes(blob)
    media = AssembledMedia(
        local_path=str(local), content_type="video/mp4", duration_seconds=1.5
    )

    # uuid-shaped segments the store's _SAFE_KEY_SEGMENT guard accepts.
    run_id = "0a1b2c3d-0000-0000-0000-000000000001"
    media_id = "0123456789abcdef0123456789abcdef"

    uri = S3MediaStore(s3, bucket).store(run_id, media_id, media)
    assert uri == f"s3://{bucket}/media/{run_id}/{media_id}.mp4"

    obj = s3.get_object(Bucket=bucket, Key=f"media/{run_id}/{media_id}.mp4")
    assert obj["Body"].read() == blob
    assert obj.get("ServerSideEncryption") == "AES256"
