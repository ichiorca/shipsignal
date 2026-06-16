"""Brand & customer brain — the generation-time grounding (migration 0025 / PO gap).

ShipSignal generated clean content but had no configurable company identity. This module is the
worker seam that grounds every draft in the company's OWN voice + ICP + approved messaging:

  * ICP segments      — who we market to (pains, objections, approved angles).
  * voice exemplars   — the company's real published content, retrieved by SEMANTIC similarity to
                        what changed (pgvector, the inverse of the peer repo's customer_voice),
                        used as few-shot style references.
  * messaging claims  — approved, evidence-backed positioning generation MAY use.

The retrieval (embed + pgvector + fetch) lives in the Aurora adapter (constitution §1: model calls
run on the worker, never the Vercel app). This module owns the pure pieces — the Pydantic models,
the ``VoiceContextSource`` port (+ in-memory fake for the unit gate), and ``format_voice_context``
which renders the retrieved context into the generation prompt. Pure of langgraph/psycopg/boto3.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

_Strict = ConfigDict(frozen=True, extra="forbid")


class IcpSegment(BaseModel):
    """One ICP segment as generation grounds against it (the fields a draft needs)."""

    model_config = _Strict

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    description: str = ""
    pain_points: tuple[str, ...] = ()
    objections: tuple[str, ...] = ()
    approved_angles: tuple[str, ...] = ()


class VoiceExemplar(BaseModel):
    """A retrieved piece of the company's own published content (a style reference)."""

    model_config = _Strict

    id: str = Field(min_length=1)
    title: str = ""
    body_text: str = Field(min_length=1)
    channel: str = "any"
    source: str | None = None


class MessagingClaim(BaseModel):
    """An approved, evidence-backed claim generation MAY use (never invent others)."""

    model_config = _Strict

    id: str = Field(min_length=1)
    claim_text: str = Field(min_length=1)
    claim_type: str = "positioning"
    evidence_url: str | None = None


class VoiceContext(BaseModel):
    """The bundle retrieved for one generation: voice exemplars + messaging + ICP."""

    model_config = _Strict

    exemplars: tuple[VoiceExemplar, ...] = ()
    claims: tuple[MessagingClaim, ...] = ()
    segments: tuple[IcpSegment, ...] = ()

    def is_empty(self) -> bool:
        return not (self.exemplars or self.claims or self.segments)


@runtime_checkable
class VoiceContextSource(Protocol):
    """Retrieve the brand/customer grounding for a generation, ranked by relevance to the
    release. ``query_text`` is the rendered approved-feature manifest; ``channel`` is the target
    artifact type (or None for any). ``AuroraVoiceContextSource`` satisfies this at runtime."""

    def retrieve(
        self, query_text: str, channel: str | None = None, top_k: int = 3
    ) -> VoiceContext: ...


class InMemoryVoiceContextSource:
    """In-process ``VoiceContextSource`` for the unit gate — returns a fixed context (optionally
    channel-filtered for the exemplars), so the generation/formatting logic is exercised without
    Bedrock or pgvector (mirrors the other in-memory fakes)."""

    def __init__(self, fixed: VoiceContext) -> None:
        self._fixed = fixed

    def retrieve(
        self, query_text: str, channel: str | None = None, top_k: int = 3
    ) -> VoiceContext:
        exemplars = self._fixed.exemplars
        if channel is not None:
            matched = tuple(
                e for e in exemplars if e.channel == channel or e.channel == "any"
            )
            exemplars = matched or exemplars
        return self._fixed.model_copy(update={"exemplars": exemplars[:top_k]})


_EXCERPT_CHARS = 600
_MAX_EXEMPLARS = 3


def _excerpt(text: str) -> str:
    cleaned = text.strip()
    return cleaned if len(cleaned) <= _EXCERPT_CHARS else f"{cleaned[:_EXCERPT_CHARS]}…"


def format_voice_context(ctx: VoiceContext) -> str:
    """Render the retrieved context into a generation-prompt block. Empty context → empty string
    (so generation is unchanged when no brand brain is configured). Pure + deterministic."""
    if ctx.is_empty():
        return ""

    sections: list[str] = []

    if ctx.segments:
        lines = [
            "Write for these audiences (ICP) — speak to their pains and use approved angles:"
        ]
        for seg in ctx.segments:
            parts = [f"- {seg.name}"]
            if seg.pain_points:
                parts.append(f"pains: {'; '.join(seg.pain_points)}")
            if seg.objections:
                parts.append(f"objections: {'; '.join(seg.objections)}")
            if seg.approved_angles:
                parts.append(f"angles: {'; '.join(seg.approved_angles)}")
            lines.append(" — ".join(parts))
        sections.append("\n".join(lines))

    if ctx.claims:
        lines = ["Approved messaging you MAY use (do not invent other claims):"]
        for claim in ctx.claims:
            lines.append(f"- [{claim.claim_type}] {claim.claim_text}")
        sections.append("\n".join(lines))

    if ctx.exemplars:
        lines = [
            "Match the tone, structure, and phrasing of these REAL examples of our published "
            "voice. Do NOT copy them verbatim — write new content in this voice:"
        ]
        for i, ex in enumerate(ctx.exemplars[:_MAX_EXEMPLARS], start=1):
            header = f"[Example {i} · {ex.channel}]"
            if ex.title:
                header += f" {ex.title}"
            lines.append(f"{header}\n{_excerpt(ex.body_text)}")
        sections.append("\n\n".join(lines))

    return "--- COMPANY VOICE & MESSAGING ---\n" + "\n\n".join(sections)
