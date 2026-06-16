"""T5 (spec 008) — runtime S3 adapter for storing assembled demo media.

P4 (Storage) + s3-rules: the assembled binary (video/audio) goes to a PRIVATE bucket with
server-side encryption, under a sanitized, run-scoped key; only the ``s3://`` URI is returned
(persisted in Aurora). The UI reaches the object solely through a server-minted, short-expiry,
GET-scoped presigned URL (the Next.js layer) — never a public object. Imported only by
``__main__`` at runtime (needs boto3), so the unit gate never imports it.
"""

from __future__ import annotations

import re
from pathlib import Path

from release_worker.media_models import AssembledMedia, CaptureResult

# release_run_id / media_id are uuid4 hex or canonical UUIDs we mint — never attacker-
# controlled — but we still validate before composing an S3 key so a future caller can't
# smuggle a path-traversal segment (s3-rules: sanitize object keys).
_SAFE_KEY_SEGMENT = re.compile(r"\A[0-9a-fA-F-]{8,36}\Z")

# MIME → object extension for the stored media key.
_EXTENSIONS = {
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
}


def _safe_segment(value: str, label: str) -> str:
    if not _SAFE_KEY_SEGMENT.fullmatch(value):
        raise ValueError(f"unsafe {label} for S3 key")
    return value


class S3MediaStore:
    """Upload assembled media to a private, encrypted, run-scoped S3 key (PRD §5.4)."""

    def __init__(self, s3_client: object, bucket: str) -> None:
        self._s3 = s3_client
        self._bucket = bucket

    def store(self, release_run_id: str, media_id: str, media: AssembledMedia) -> str:
        run = _safe_segment(release_run_id, "release_run_id")
        mid = _safe_segment(media_id, "media_id")
        ext = _EXTENSIONS.get(media.content_type, "bin")
        key = f"media/{run}/{mid}.{ext}"
        self._put_file(key, Path(media.local_path), media.content_type)
        return f"s3://{self._bucket}/{key}"

    def store_raw(
        self, release_run_id: str, media_id: str, capture: CaptureResult
    ) -> str:
        # spec 014 T3 / §16.3 — the RAW Playwright recording goes to a DISTINCT key (``-raw``)
        # from the final assembled media, so the two are stored separately and a reviewer can
        # inspect the pre-narration capture even when a later step broke. Same private bucket +
        # SSE + sanitized run-scoped key (s3-rules).
        run = _safe_segment(release_run_id, "release_run_id")
        mid = _safe_segment(media_id, "media_id")
        key = f"media/{run}/{mid}-raw.webm"
        self._put_file(key, Path(capture.video_local_path), "video/webm")
        return f"s3://{self._bucket}/{key}"

    def _put_file(self, key: str, local_path: Path, content_type: str) -> None:
        # Stream the file to S3 (boto3 uses multipart for large objects) rather than reading the
        # whole asset into memory — a 100-500 MB demo video would otherwise risk an OOM kill on
        # the Actions runner and doubles peak memory. SSE + ContentType ride along as ExtraArgs.
        # mypy can't see boto3's dynamic client surface; call via the bound method.
        with local_path.open("rb") as fileobj:
            self._s3.upload_fileobj(  # type: ignore[attr-defined]
                fileobj,
                self._bucket,
                key,
                ExtraArgs={
                    "ContentType": content_type,
                    "ServerSideEncryption": "AES256",
                },
            )
