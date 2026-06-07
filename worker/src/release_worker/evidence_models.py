"""T2/T3/T4 (spec 002) — Pydantic models for the evidence-collection slice.

P5 (Safety rails) + stack-python: every boundary/diff payload that enters the graph
is validated through a Pydantic v2 model rather than a raw dict, so a malformed diff
fails closed at the edge (AC4). The model layer also encodes the constitution's
"redact before persist" gate (§5) *structurally*: collection produces
``CollectedEvidence`` (carries the untrusted raw excerpt), the redact node converts
it to ``RedactedEvidence`` (no raw field at all), and only ``RedactedEvidence`` /
``EvidenceRecord`` can be handed to the persist node. It is therefore impossible to
persist un-redacted text without a type error — the ordering is not merely a runtime
check (anti-pattern #4: the gate is exercised through the real types, not a helper).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# Frozen + extra="forbid" everywhere: evidence is untrusted input (P5 / github-rules
# "treat ingested GitHub text as injection-capable"), so unknown fields are rejected
# rather than silently carried, and values can't be mutated after validation.
_StrictModel = ConfigDict(frozen=True, extra="forbid")


class ReleaseBoundary(BaseModel):
    """The compare range a run collects evidence over (PRD §5.2 load_release_boundary).

    Resolved from the ``release_runs`` row: which repo and which base..head refs the
    git diff is taken between.
    """

    model_config = _StrictModel

    release_run_id: str = Field(min_length=1)
    repo: str = Field(min_length=1)
    base_ref: str = Field(min_length=1)
    head_ref: str = Field(min_length=1)


class DiffHunk(BaseModel):
    """A single hunk within a changed file's patch."""

    model_config = _StrictModel

    line_range: str = Field(min_length=1)
    patch: str


class RawDiffFile(BaseModel):
    """One changed file in the compare range, as returned by the diff source.

    ``patch_text`` is the concatenated unified-diff text for the file and is treated
    as untrusted: it may contain emails, secrets, or injection payloads. It must pass
    redaction before it reaches S3/Aurora/state.
    """

    model_config = _StrictModel

    file_path: str = Field(min_length=1)
    status: str = Field(min_length=1)  # added | modified | removed | renamed
    patch_text: str = ""
    hunks: tuple[DiffHunk, ...] = ()


class RawDiffPayload(BaseModel):
    """The validated boundary diff: all changed files for one compare range.

    ``RawDiffPayload.model_validate`` is the single boundary check for the collect
    node (AC4); a malformed payload raises ``pydantic.ValidationError`` which the node
    converts into a user-safe ``MalformedDiffError``.
    """

    model_config = _StrictModel

    repo: str = Field(min_length=1)
    base_ref: str = Field(min_length=1)
    head_ref: str = Field(min_length=1)
    files: tuple[RawDiffFile, ...] = ()


class CollectedEvidence(BaseModel):
    """Untrusted evidence straight out of collection — BEFORE redaction.

    Carries ``raw_excerpt`` (may contain PII/secrets). This type must never be handed
    to the persist node; it exists only to flow from collect → redact.
    """

    model_config = _StrictModel

    evidence_type: str = Field(min_length=1)
    source: str = Field(min_length=1)
    repo: str = Field(min_length=1)
    source_url: str | None = None
    file_path: str | None = None
    symbol_name: str | None = None
    raw_excerpt: str
    metadata: dict[str, str | int] = Field(default_factory=dict)


class RedactedEvidence(BaseModel):
    """Evidence AFTER the redact node. There is no raw field — by construction it
    cannot leak un-redacted text downstream (constitution §5).

    ``risk_flags`` records what the redactor stripped (e.g. ``"email"``,
    ``"secret:aws_access_key"``) so reviewers can see why an excerpt was modified.
    """

    model_config = _StrictModel

    evidence_type: str = Field(min_length=1)
    source: str = Field(min_length=1)
    repo: str = Field(min_length=1)
    source_url: str | None = None
    file_path: str | None = None
    symbol_name: str | None = None
    redacted_excerpt: str
    risk_flags: tuple[str, ...] = ()
    metadata: dict[str, str | int] = Field(default_factory=dict)


class EvidenceRecord(BaseModel):
    """A persisted evidence_items row: redacted content + the S3 key of the redacted
    full excerpt. This is what the persist node inserts into Aurora and what the
    dashboard reads back (PRD §6.3 / §10.1).
    """

    model_config = _StrictModel

    evidence_id: str = Field(min_length=1)
    release_run_id: str = Field(min_length=1)
    evidence_type: str = Field(min_length=1)
    source: str = Field(min_length=1)
    repo: str = Field(min_length=1)
    source_url: str | None = None
    file_path: str | None = None
    symbol_name: str | None = None
    raw_excerpt_s3_uri: str = Field(min_length=1)
    redacted_excerpt: str
    risk_flags: tuple[str, ...] = ()
    metadata: dict[str, str | int] = Field(default_factory=dict)


class MalformedDiffError(ValueError):
    """Raised when a diff payload fails boundary validation.

    The message is user-safe: it never echoes the offending raw payload (which could
    contain PII/secrets), only that the payload was rejected (AC4 / GDPR rules).
    """

    def __init__(self) -> None:
        super().__init__("the diff payload was malformed and was rejected")
