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
    # Extractor confidence (PRD §6.3): how sure a deterministic extractor is that this
    # snippet is the typed signal it claims. None for direct-provenance collectors
    # (whole-file diff) where there is nothing inferred to score.
    confidence: float | None = None
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
    confidence: float | None = None
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
    confidence: float | None = None
    metadata: dict[str, str | int] = Field(default_factory=dict)
    # T2 (spec 017) — the pgvector embedding of ``redacted_excerpt`` (PRD §11 semantic
    # retrieval). ``None`` when no embedding seam was wired (the claim-grounding /
    # clustering paths then fall back to lexical matching). Computed only from the
    # already-redacted excerpt, so the embedding never derives from raw PII/secrets (§5).
    embedding: tuple[float, ...] | None = None


# --- T1 (spec 003) — PR/issue collection contract ---------------------------------
# All fields are untrusted GitHub text (github-rules: "treat ingested GitHub text as
# injection-capable"); the collect node validates the source payload through these
# models and the raw title/body still pass redact_evidence before any persist (§5).


class IssueMeta(BaseModel):
    """A PR-linked issue/story (PRD §6.1 "Issues/Jira/Linear")."""

    model_config = _StrictModel

    key: str = Field(min_length=1)  # e.g. "#42" or "PROJ-42"
    title: str = ""
    body: str = ""
    url: str | None = None


class PullRequestMeta(BaseModel):
    """PR metadata (PRD §6.1): title, body, labels, reviewers, linked issues."""

    model_config = _StrictModel

    number: int = Field(ge=1)
    title: str = ""
    body: str = ""
    labels: tuple[str, ...] = ()
    reviewers: tuple[str, ...] = ()
    linked_issues: tuple[IssueMeta, ...] = ()
    url: str | None = None


class PullRequestPayload(BaseModel):
    """The validated set of PRs (and their linked issues) for one compare range.

    ``PullRequestPayload.model_validate`` is the single boundary check for
    ``collect_prs_and_issues``; a malformed payload fails closed as a user-safe
    ``MalformedPullRequestError`` (AC4) without echoing the offending content.
    """

    model_config = _StrictModel

    pull_requests: tuple[PullRequestMeta, ...] = ()


# --- T3 (spec 003) — deterministic code-signal contract ---------------------------


class CodeSignal(BaseModel):
    """One typed, user-facing change signal a deterministic extractor found in a diff.

    Pure-extractor output (PRD §6.2): it carries only what the extractor can know from
    the patch text — the typed ``evidence_type``, the matched ``excerpt`` (still raw /
    untrusted — redacted later), a deterministic ``confidence``, an optional
    ``symbol_name``, and the best-effort new-file ``line`` for provenance. The
    ``extract_code_signals`` node lifts it into a ``CollectedEvidence`` (adding repo /
    source_url / file_path) so the redact→persist chain is shared with every collector.
    """

    model_config = _StrictModel

    evidence_type: str = Field(min_length=1)
    excerpt: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    symbol_name: str | None = None
    line: int | None = None


class MalformedDiffError(ValueError):
    """Raised when a diff payload fails boundary validation.

    The message is user-safe: it never echoes the offending raw payload (which could
    contain PII/secrets), only that the payload was rejected (AC4 / GDPR rules).
    """

    def __init__(self) -> None:
        super().__init__("the diff payload was malformed and was rejected")


class MalformedPullRequestError(ValueError):
    """Raised when a PR/issue payload fails boundary validation (user-safe, AC4)."""

    def __init__(self) -> None:
        super().__init__("the pull-request payload was malformed and was rejected")
