"""Brand & customer brain (migration 0025) — the pure voice-context grounding: the formatter,
the in-memory source's channel filter, and the generation-prompt injection seam."""

from __future__ import annotations

from release_worker.content_nodes import _system_prompt
from release_worker.voice_context import (
    IcpSegment,
    InMemoryVoiceContextSource,
    MessagingClaim,
    VoiceContext,
    VoiceExemplar,
    format_voice_context,
)


def _ctx() -> VoiceContext:
    return VoiceContext(
        segments=(
            IcpSegment(
                id="seg_platform_engineer",
                name="Platform engineer",
                pain_points=("Manual release comms eat a day",),
                approved_angles=("Ship the release, not the busywork",),
            ),
        ),
        claims=(
            MessagingClaim(
                id="c1",
                claim_text="On-brand release content straight from your diffs.",
                claim_type="positioning",
            ),
        ),
        exemplars=(
            VoiceExemplar(
                id="e1",
                title="v1.10 launch blog",
                body_text="We shipped one-click rollback today. No drama, just a button.",
                channel="release_blog",
            ),
            VoiceExemplar(
                id="e2", body_text="Generic any-channel exemplar.", channel="any"
            ),
        ),
    )


def test_format_renders_icp_messaging_and_voice_exemplars() -> None:
    rendered = format_voice_context(_ctx())
    assert "COMPANY VOICE & MESSAGING" in rendered
    assert "Platform engineer" in rendered  # ICP grounding
    assert "Ship the release, not the busywork" in rendered  # approved angle
    assert (
        "On-brand release content straight from your diffs." in rendered
    )  # messaging claim
    assert "one-click rollback" in rendered  # real voice exemplar
    assert (
        "do not copy" in rendered.lower()
    )  # the "don't plagiarize, match the voice" instruction


def test_empty_context_renders_empty_string() -> None:
    # No brand brain configured ⇒ no block ⇒ generation prompt is unchanged.
    assert format_voice_context(VoiceContext()) == ""


def test_in_memory_source_filters_exemplars_by_channel() -> None:
    source = InMemoryVoiceContextSource(_ctx())
    blog = source.retrieve("rollback feature", channel="release_blog")
    channels = {e.channel for e in blog.exemplars}
    # The blog-specific exemplar and the 'any' exemplar match; nothing else.
    assert channels <= {"release_blog", "any"}
    assert any(e.channel == "release_blog" for e in blog.exemplars)


def test_generation_prompt_injects_voice_context() -> None:
    # The grounding block is appended to the system prompt only when supplied (the default keeps
    # the pre-brand-brain prompt byte-for-byte unchanged — backward compatible).
    block = format_voice_context(_ctx())
    with_voice = _system_prompt("release blog", (), block)
    without_voice = _system_prompt("release blog", ())
    assert "COMPANY VOICE & MESSAGING" in with_voice
    assert "one-click rollback" in with_voice
    assert "COMPANY VOICE & MESSAGING" not in without_voice
