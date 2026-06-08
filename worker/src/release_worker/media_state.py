"""T2-T5 (spec 008) — LangGraph graph state for ``media_generation_graph`` (PRD §5.4).

P5 (Safety rails) + stack-python: all data threaded between nodes is validated Pydantic v2,
never a raw dict. The click-path is carried in two distinct shapes by design — the untrusted
``GeneratedClickPath`` (model output) and, only after the strict allowlist passes, the
``ValidatedClickPath`` that ``run_playwright_capture`` consumes. The state never holds raw
demo-script-derived blobs beyond the approved title/body the graph loaded (constitution §5).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from release_worker.media_models import (
    AssembledMedia,
    CaptureResult,
    GeneratedClickPath,
    MediaAsset,
    NarrationResult,
    ValidatedClickPath,
)


class MediaRunState(BaseModel):
    """State threaded through ``media_generation_graph`` (PRD §5.4).

    Identifies the run + thread, then accumulates: the approved demo_script the graph loaded
    (its artifact id + title + body + originating feature), the generated then strict-validated
    click-path, the Playwright capture, the materialized narration, the ffmpeg-assembled media,
    its S3 URI, and finally the persisted media asset. ``validated_click_path`` is set only by
    the validate node — the capture node reads exactly that field (constitution §5)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    release_run_id: str = Field(min_length=1)
    thread_id: str = Field(min_length=1)
    media_id: str = Field(min_length=1)
    voice_id: str = Field(min_length=1)
    model_id: str = Field(min_length=1)
    output_format: str = Field(min_length=1)

    # Set by load_approved_demo_script (fails closed if no approved demo_script).
    source_artifact_id: str | None = None
    feature_id: str | None = None
    demo_title: str = ""
    demo_body: str = ""

    # The click-path in its two shapes — untrusted (generated) then safe (validated).
    generated_click_path: GeneratedClickPath | None = None
    validated_click_path: ValidatedClickPath | None = None

    capture: CaptureResult | None = None
    narration: NarrationResult | None = None
    assembled_media: AssembledMedia | None = None
    s3_uri: str | None = None
    media_asset: MediaAsset | None = None
