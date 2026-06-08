"""T5 (spec 008) — runtime Aurora adapters for the media-generation nodes.

P4 (Storage): the approved demo_script and the persisted media_assets row both live in Aurora.
aurora-rules: every statement is parameterised; the connection is the shared short-lived job
connection. Imported only by ``__main__`` at runtime (needs psycopg), so the unit gate never
imports it — the nodes are tested against the in-memory fakes.

constitution §5: ``AuroraDemoScriptReader`` loads ONLY a Gate#2-approved demo_script (status =
'approved'), so the media graph can never render from an unapproved script.
"""

from __future__ import annotations

import json

import psycopg

from release_worker.media_models import MediaAsset
from release_worker.media_ports import NoApprovedDemoScriptError


class AuroraDemoScriptReader:
    """Load a run's Gate#2-approved ``demo_script`` artifact (PRD §5.4)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def load_approved_demo_script(
        self, release_run_id: str
    ) -> tuple[str, str, str, str | None]:
        # Scoped to the run + artifact_type + status='approved' (constitution §2 tenancy / §5
        # no unapproved content). Newest approved demo_script wins if more than one exists.
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, title, body_markdown, feature_id
                  FROM artifacts
                 WHERE release_run_id = %s
                   AND artifact_type = 'demo_script'
                   AND status = 'approved'
                 ORDER BY updated_at DESC
                 LIMIT 1
                """,
                (release_run_id,),
            )
            row = cur.fetchone()
        if row is None:
            raise NoApprovedDemoScriptError()
        return (
            str(row[0]),
            row[1] or "",
            row[2] or "",
            (str(row[3]) if row[3] else None),
        )


class AuroraMediaAssetSink:
    """Persist a ``media_assets`` row (PRD §5.4 / migration 0007)."""

    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def insert_media_asset(self, asset: MediaAsset) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO media_assets (
                    id, release_run_id, feature_id, source_artifact_id, media_type,
                    s3_uri, content_type, duration_seconds, status, provenance_json
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
                """,
                (
                    asset.media_id,
                    asset.release_run_id,
                    asset.feature_id,
                    asset.source_artifact_id,
                    asset.media_type,
                    asset.s3_uri,
                    asset.content_type,
                    asset.duration_seconds,
                    asset.status,
                    json.dumps(asset.provenance),
                ),
            )
