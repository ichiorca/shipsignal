"""T2/T3/T4/T5 (spec 008) — Pydantic models for media_generation_graph (PRD §5.4): the
click-path the model proposes, the strict-validated click-path Playwright executes, the
narration result, the capture result, and the persisted media asset.

P5 (Safety rails) + constitution §5 — the click-path is *model-emitted instructions that
will drive a browser*, so it is the most safety-critical untrusted boundary in the slice.
Two layers defend it:

* ``GeneratedClickPath`` is the boundary validator for the raw Bedrock output — a malformed
  payload fails closed as ``MalformedClickPathError`` without echoing the offending content.
* ``ValidatedClickPath`` is a *distinct* type that ONLY ``validate_click_path`` can mint: every
  step's action is in the allowed enum and every selector matches the strict safe-selector
  pattern (no ``javascript:``, no inline handlers, no script/data URIs). ``run_playwright_capture``
  accepts only a ``ValidatedClickPath``, so an unvalidated or rejected path can never reach
  Playwright (the AC: "an invalid/malicious click-path is rejected and never reaches Playwright").

P4 (Storage): ``MediaAsset`` mirrors the ``media_assets`` row (0007); the binary lives in S3
and the row carries only the key + provenance. ``NarrationResult.content_hash`` is the
ElevenLabs idempotency key (elevenlabs-rules: TTS has no idempotency header — we enforce it).
"""

from __future__ import annotations

import re
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

# Frozen + extra="forbid" everywhere: model output and capture results are untrusted input,
# so unknown fields are rejected rather than silently carried, and a validated value can't be
# mutated after the fact (a ValidatedClickPath stays validated).
_StrictModel = ConfigDict(frozen=True, extra="forbid")


class ClickAction(StrEnum):
    """The closed set of browser actions a click-path step may request (PRD §5.4 capture).

    Deliberately tiny and side-effect-bounded: navigate within the app, interact with a
    control, type fixture text, or wait/assert. There is no ``evaluate``/``script`` action —
    the system never executes model-emitted code (constitution §5). An unknown action fails
    validation and the path is rejected before Playwright runs."""

    NAVIGATE = "navigate"
    CLICK = "click"
    FILL = "fill"
    WAIT_FOR_SELECTOR = "wait_for_selector"
    EXPECT_TEXT = "expect_text"


# Actions that target a DOM element and therefore REQUIRE a safe selector.
SELECTOR_ACTIONS = frozenset(
    {
        ClickAction.CLICK,
        ClickAction.FILL,
        ClickAction.WAIT_FOR_SELECTOR,
        ClickAction.EXPECT_TEXT,
    }
)

# A conservative safe-selector allowlist: id (#foo), class (.foo), tag, attribute
# ([data-testid="x"]), descendant combinator, and the data-testid/role/aria conventions the
# fixtures use. Crucially it forbids ':', '(', '<', '>', quotes-with-scheme, and whitespace
# tricks that could smuggle ``javascript:`` / pseudo-injection. Anchored full-match.
_SAFE_SELECTOR = re.compile(r"\A[a-zA-Z0-9 _\-#.\[\]=\"']{1,200}\Z")
# Tokens that must never appear in a selector even if they pass the charset (defense in depth).
_FORBIDDEN_SELECTOR_TOKENS = ("javascript:", "data:", "<", ">", "{", "}", "//")

# Only same-app relative navigation is allowed (a leading '/'), never an absolute/remote URL
# or a scheme — the capture stays inside the synthetic fixture app (constitution §1: capture
# runs only on the Actions runner against fixture data).
_SAFE_PATH = re.compile(r"\A/[a-zA-Z0-9/_\-?=&.]{0,200}\Z")

# Bound the path so a model can't emit a 10k-step capture (constitution §6 cost/latency).
MAX_STEPS = 40


class GeneratedClickStep(BaseModel):
    """One step as proposed by Bedrock (untrusted), pre-strict-validation.

    Fields are accepted permissively as strings here; ``validate_click_path`` is what enforces
    the action enum + safe selector/target. ``narration`` is the spoken line for this step
    (fed to ElevenLabs later); it carries no executable meaning."""

    model_config = _StrictModel

    action: str = Field(min_length=1)
    selector: str | None = None
    # For navigate: a relative app path. For fill: the fixture text to type.
    target: str | None = None
    narration: str | None = None


class GeneratedClickPath(BaseModel):
    """The validated *shape* of the raw Bedrock click-path response (boundary check for
    ``generate_click_path_json``). A structurally malformed payload raises ``ValidationError``
    which the node converts into a user-safe ``MalformedClickPathError``. Structural validity
    is NOT safety — ``validate_click_path`` still applies the strict action/selector allowlist."""

    model_config = _StrictModel

    steps: tuple[GeneratedClickStep, ...] = ()


class ClickStep(BaseModel):
    """One strict-validated step (every field already checked against the allowlist).

    Distinct from ``GeneratedClickStep`` so the type system records that this value passed
    validation. ``action`` is a real ``ClickAction``; ``selector``/``target`` are present and
    safe exactly when the action requires them."""

    model_config = _StrictModel

    action: ClickAction
    selector: str | None = None
    target: str | None = None
    narration: str | None = None


class ValidatedClickPath(BaseModel):
    """A click-path that has passed ``validate_click_path`` — the ONLY input
    ``run_playwright_capture`` accepts (constitution §5: a rejected/unvalidated path can never
    reach Playwright). Minting one outside ``validate_click_path`` is possible in code, but the
    graph wiring only ever produces it there, and the validator is the single gate the AC tests
    exercise."""

    model_config = _StrictModel

    steps: tuple[ClickStep, ...] = Field(min_length=1)


class CaptureFrame(BaseModel):
    """One screenshot captured for a step (PRD §5.4). ``s3_key_suffix`` is the deterministic
    per-frame suffix the store uses; ``local_path`` is the on-runner file Playwright wrote."""

    model_config = _StrictModel

    step_index: int = Field(ge=0)
    local_path: str = Field(min_length=1)


class CaptureResult(BaseModel):
    """The deterministic output of the Playwright capture (T3, PRD §5.4).

    ``video_local_path`` is the assembled-from-frames clip on the runner; ``frames`` are the
    per-step screenshots; ``duration_seconds`` is the captured timeline. All paths are local to
    the Actions runner — nothing is in S3 yet (store happens in T5)."""

    model_config = _StrictModel

    video_local_path: str = Field(min_length=1)
    frames: tuple[CaptureFrame, ...] = ()
    duration_seconds: float = Field(ge=0.0)
    step_count: int = Field(ge=0)


class NarrationConfig(BaseModel):
    """The ElevenLabs call parameters (elevenlabs-rules: voice_id/model_id/output_format are
    CONFIG, not hardcoded constants). Carried explicitly so the content-hash idempotency key
    folds them in — a voice/model/format change is a different asset."""

    model_config = _StrictModel

    voice_id: str = Field(min_length=1)
    model_id: str = Field(min_length=1)
    output_format: str = Field(min_length=1)


class NarrationResult(BaseModel):
    """The materialized narration audio (T4, PRD §5.4).

    ``content_hash`` is the deterministic hash of (text + voice_id + model_id + output_format)
    — the idempotency key (elevenlabs-rules: TTS has no idempotency header, enforce it
    ourselves). ``materialized`` asserts the audio is fully on disk/in-bytes (NOT a partial
    stream) — ``assemble_video_ffmpeg`` refuses to run until it is true (the AC: ffmpeg only
    assembles after audio is fully materialized)."""

    model_config = _StrictModel

    content_hash: str = Field(min_length=1)
    audio_local_path: str = Field(min_length=1)
    voice_id: str = Field(min_length=1)
    model_id: str = Field(min_length=1)
    output_format: str = Field(min_length=1)
    char_count: int = Field(ge=0)
    materialized: bool = False


class AssembledMedia(BaseModel):
    """The ffmpeg-assembled media on the runner (T5), pre-S3-upload.

    ``local_path`` is the final muxed file (video+audio, or audio-only digest); ``content_type``
    is its MIME type for the S3 object + the dashboard player."""

    model_config = _StrictModel

    local_path: str = Field(min_length=1)
    content_type: str = Field(min_length=1)
    duration_seconds: float = Field(ge=0.0)


class MediaAsset(BaseModel):
    """A persisted ``media_assets`` row (PRD §5.4 / migration 0007).

    ``s3_uri`` references the stored binary (never inlined). ``provenance`` is the §18.3 audit
    trail (source demo_script artifact id, validated click-path hash, narration content hash,
    voice/model ids) so the rendered media is traceable to its approved source + inputs."""

    model_config = _StrictModel

    media_id: str = Field(min_length=1)
    release_run_id: str = Field(min_length=1)
    feature_id: str | None = None
    source_artifact_id: str | None = None
    media_type: str = Field(min_length=1)  # demo_video | release_audio_digest
    s3_uri: str = Field(min_length=1)
    content_type: str = Field(min_length=1)
    duration_seconds: float | None = None
    status: str = "ready"
    provenance: dict[str, str] = Field(default_factory=dict)


class MalformedClickPathError(ValueError):
    """Raised when the raw Bedrock click-path output fails *structural* boundary validation.

    User-safe: never echoes the offending model output (built from the demo script, could carry
    residual sensitive content), only that it was rejected (constitution §5)."""

    def __init__(self) -> None:
        super().__init__("the model click-path output was malformed and was rejected")


class ClickPathValidationError(ValueError):
    """Raised when a structurally-valid click-path violates the strict safety allowlist — an
    unknown action, a missing/unsafe selector, or an unsafe navigation target.

    This is the gate that keeps a malicious click-path out of Playwright (the AC). The message
    names the rule + step index that failed but NEVER echoes the offending selector/target
    value (constitution §5: a leaked value could itself be an injection payload)."""

    def __init__(self, step_index: int, reason: str) -> None:
        self.step_index = step_index
        self.reason = reason
        super().__init__(f"click-path step {step_index} rejected: {reason}")


def is_safe_selector(selector: str) -> bool:
    """True iff ``selector`` matches the strict allowlist AND carries no forbidden token.

    Pure + deterministic so ``validate_click_path`` and its tests share one definition of safe.
    """
    if not _SAFE_SELECTOR.fullmatch(selector):
        return False
    lowered = selector.lower()
    return not any(token in lowered for token in _FORBIDDEN_SELECTOR_TOKENS)


def is_safe_target_path(target: str) -> bool:
    """True iff ``target`` is a same-app relative path (leading '/', no scheme/host)."""
    return bool(_SAFE_PATH.fullmatch(target))
