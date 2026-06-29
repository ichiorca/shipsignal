"""Seed ONE complete end-to-end demo run for the dashboard (hackathon demo).

Runs the real release→content pipeline against the configured DB + S3, using the offline
``DemoModelClient`` for the LLM stages (Bedrock is account-held) and the REAL ElevenLabs MP3 / ffmpeg
MP4 as the media assets. The result is a fully-populated run the dashboard renders: evidence →
feature manifest → artifacts → audio/video media.

REAL: GitHub diff + PRs, redaction, deterministic signals, persistence to Aurora + S3, the audio/
video. DEMO: the LLM-written feature manifest + artifact prose (representative, grounded in the real
evidence ids). Flip DEMO_MODE off + restore Bedrock access and the same flow runs live.

Env:
  DATABASE_URL            Postgres DSN (plain postgresql:// form)
  AWS_ENDPOINT_URL_S3     S3 endpoint (LocalStack http://localhost:4566; unset = real AWS)
  EVIDENCE_BUCKET / MEDIA_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID/SECRET
  GITHUB_TOKEN            for the live compare
  MEDIA_DIR               dir holding hermes_v0_17_digest.mp3/.mp4 (default <repo>/demo/assets)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from uuid import uuid4

import boto3
import psycopg

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "worker" / "src"))

from release_worker.aurora_content import AuroraArtifactSink, AuroraSkillSnapshotSink
from release_worker.aurora_evidence import S3AuroraEvidenceSink
from release_worker.aurora_features import (
    AuroraFeatureSink,
    AuroraRedactedEvidenceReader,
)
from release_worker.aurora_media import AuroraMediaAssetSink
from release_worker.content_models import ApprovedFeature
from release_worker.content_nodes import (
    generate_artifacts_parallel,
    persist_reviewable_artifacts,
    snapshot_active_skills,
)
from release_worker.demo_model_client import DemoModelClient
from release_worker.evidence_models import ReleaseBoundary
from release_worker.evidence_nodes import collect_redact_persist_all
from release_worker.evidence_ports import (
    InMemoryBoundaryReader,
    StaticPullRequestSource,
)
from release_worker.feature_nodes import (
    cluster_features_with_bedrock,
    persist_feature_manifest,
    score_features,
)
from release_worker.github_diff_source import GitHubDiffSource
from release_worker.github_pr_source import GitHubPullRequestSource
from release_worker.media_models import MediaAsset
from release_worker.repo_skill_source import FilesystemSkillSource

REPO = "NousResearch/hermes-agent"
BASE, HEAD = "v2026.6.5", "v2026.6.19"  # Hermes Agent v0.16.0 -> v0.17.0
ARTIFACT_TYPES = ("release_blog", "changelog_entry", "linkedin_post", "customer_email")


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("AWS_ENDPOINT_URL_S3")
        or os.environ.get("AWS_ENDPOINT_URL"),
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID", "test"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY", "test"),
    )


def _ensure_bucket(s3, bucket: str) -> None:
    try:
        s3.head_bucket(Bucket=bucket)
    except Exception:
        s3.create_bucket(Bucket=bucket)


def main() -> int:
    dsn = os.environ["DATABASE_URL"]
    if "sslmode=" not in dsn:
        dsn += ("&" if "?" in dsn else "?") + "sslmode=require"
    ev_bucket = os.environ["EVIDENCE_BUCKET"]
    media_bucket = os.environ.get("MEDIA_BUCKET", ev_bucket)
    media_dir = Path(os.environ.get("MEDIA_DIR", _REPO_ROOT / "demo" / "assets"))

    s3 = _s3()
    _ensure_bucket(s3, ev_bucket)
    _ensure_bucket(s3, media_bucket)
    conn = psycopg.connect(dsn, autocommit=True)
    model = DemoModelClient()
    run_id = str(uuid4())

    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO release_runs (id, repo, base_ref, head_ref, trigger_type, status) "
            "VALUES (%s,%s,%s,%s,'manual','created')",
            (run_id, REPO, BASE, HEAD),
        )
    print(f"run {run_id}  {REPO} {BASE}...{HEAD}")

    # 1) REAL evidence: live GitHub diff + PRs -> redact -> persist (Aurora + S3).
    reader = InMemoryBoundaryReader()
    reader.seed(
        ReleaseBoundary(release_run_id=run_id, repo=REPO, base_ref=BASE, head_ref=HEAD)
    )
    pr_source = (
        GitHubPullRequestSource.from_env()
        if os.environ.get("GITHUB_TOKEN")
        else StaticPullRequestSource({})
    )
    sink = S3AuroraEvidenceSink(conn, s3, ev_bucket)
    records = collect_redact_persist_all(
        run_id, reader, GitHubDiffSource.from_env(), pr_source, sink
    )
    print(f"  evidence: {len(records)} records persisted")

    # 2) DEMO clustering (cites real evidence ids) -> score -> persist manifest.
    evidence = AuroraRedactedEvidenceReader(conn).list_redacted_evidence(run_id)
    candidates = cluster_features_with_bedrock(run_id, evidence, model)
    scored = score_features(candidates, evidence)
    feature_sink = AuroraFeatureSink(conn)
    features = persist_feature_manifest(
        run_id, scored, evidence, feature_sink, lambda: uuid4().hex
    )
    for f in features:  # human-approve the manifest (Gate #1) for the demo run
        feature_sink.update_status(f.feature_id, "approved", "approved (demo seed)")
    print(f"  features: {len(features)} persisted + approved")

    # 3) DEMO generation: approved features -> artifacts (real skill snapshots) -> persist.
    approved = tuple(
        ApprovedFeature(
            feature_id=f.feature_id,
            release_run_id=run_id,
            title=f.title,
            summary_internal=f.summary_internal,
            user_value=f.user_value,
            audiences=f.audiences,
            change_type=f.change_type,
            surface_area=f.surface_area,
        )
        for f in features
    )
    snaps = snapshot_active_skills(
        REPO,
        FilesystemSkillSource.from_env().list_skills(),
        AuroraSkillSnapshotSink(conn),
        lambda: uuid4().hex,
    )
    artifacts, events = generate_artifacts_parallel(
        run_id,
        approved,
        snaps,
        model,
        lambda: uuid4().hex,
        model_id="demo-mode (offline)",
        selected_types=ARTIFACT_TYPES,
    )
    persist_reviewable_artifacts(artifacts, events, AuroraArtifactSink(conn))
    with conn.cursor() as cur:
        for a in artifacts:  # human-approve the artifacts (Gate #2) for the demo run
            cur.execute(
                "UPDATE artifacts SET status='approved' WHERE id=%s", (a.artifact_id,)
            )
    print(
        f"  artifacts: {len(artifacts)} persisted + approved ({', '.join(ARTIFACT_TYPES)})"
    )

    # 4) REAL media: upload the ElevenLabs MP3 + ffmpeg MP4 to S3, insert media_assets rows.
    media_sink = AuroraMediaAssetSink(conn)
    for fname, mtype, ctype in (
        ("hermes_v0_17_digest.mp3", "release_audio_digest", "audio/mpeg"),
        ("hermes_v0_17_digest.mp4", "demo_video", "video/mp4"),
    ):
        path = media_dir / fname
        if not path.is_file():
            print(f"  WARN: missing media {path}; skipping")
            continue
        key = f"media/{run_id}/{fname}"
        s3.put_object(
            Bucket=media_bucket, Key=key, Body=path.read_bytes(), ContentType=ctype
        )
        media_sink.insert_media_asset(
            MediaAsset(
                media_id=uuid4().hex,
                release_run_id=run_id,
                source_artifact_id=None,
                media_type=mtype,
                s3_uri=f"s3://{media_bucket}/{key}",
                content_type=ctype,
                duration_seconds=18.0,
                transcript=_ARTIFACT_DIGEST,
                status="ready",
                provenance={"source": "elevenlabs+ffmpeg (real)", "mode": "demo"},
            )
        )
        print(f"  media: {mtype} -> s3://{media_bucket}/{key}")

    # 5) Mark the run completed so the dashboard shows a finished end-to-end run.
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE release_runs SET status='completed', completed_at=now() WHERE id=%s",
            (run_id,),
        )
    print(f"DONE. run_id={run_id} (status=completed)")
    return 0


_ARTIFACT_DIGEST = (
    "Hermes Agent v0.17.0 hardens the build and CI pipeline, steadies the runtime adapter, and "
    "refreshes onboarding for a faster first run."
)


if __name__ == "__main__":
    raise SystemExit(main())
