"""T4 (spec 010) — the PII-scrubbing logging filter (no PII in logs/telemetry).

This IS the automated check the spec requires: it asserts that PII/secret patterns cannot
appear in an emitted log record's final text, whether the PII arrives via the format string
or a ``%s`` arg. Exercises ``PiiScrubbingFilter`` / ``install_pii_scrubbing`` — the surface
``__main__`` and ``release_worker.privacy`` wire — against a real handler capturing output.
"""

from __future__ import annotations

import io
import logging

from release_worker.log_scrubbing import PiiScrubbingFilter, install_pii_scrubbing

# Patterns that must never survive into a log line.
_PII_NEEDLES = ("alice@example.com", "AKIAIOSFODNN7EXAMPLE", "10.0.0.5")


def _make_logger(name: str) -> tuple[logging.Logger, io.StringIO]:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger(name)
    logger.handlers = [handler]
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger, stream


def test_filter_scrubs_pii_from_the_format_string() -> None:
    logger, stream = _make_logger("test.scrub.fmt")
    logger.handlers[0].addFilter(PiiScrubbingFilter())

    logger.info("owner alice@example.com pushed from 10.0.0.5")

    out = stream.getvalue()
    for needle in _PII_NEEDLES:
        assert needle not in out
    assert "[redacted-email]" in out
    assert "[redacted-ip]" in out


def test_filter_scrubs_pii_arriving_via_lazy_args() -> None:
    """Lazy %-style args are the project's logging idiom; PII in an arg must still be scrubbed."""
    logger, stream = _make_logger("test.scrub.args")
    logger.handlers[0].addFilter(PiiScrubbingFilter())

    logger.info("evidence %s for run %s", "key=AKIAIOSFODNN7EXAMPLE", "run-1")

    out = stream.getvalue()
    assert "AKIAIOSFODNN7EXAMPLE" not in out
    assert "[redacted-secret]" in out
    assert "run-1" in out  # non-PII context is preserved


def test_install_attaches_to_handlers_and_covers_propagated_records() -> None:
    """install_pii_scrubbing must scrub records that PROPAGATE from a child logger.

    A logger-level filter would miss these; a handler-level filter (what install uses) catches
    them — this guards the regression that motivated attaching to handlers, not the logger.
    """
    root_stream = io.StringIO()
    root_handler = logging.StreamHandler(root_stream)
    root_handler.setFormatter(logging.Formatter("%(message)s"))
    root = logging.getLogger("test.scrub.parent")
    root.handlers = [root_handler]
    root.setLevel(logging.INFO)
    root.propagate = False

    install_pii_scrubbing(root)

    child = logging.getLogger("test.scrub.parent.child")
    child.setLevel(logging.INFO)
    child.info("leak alice@example.com")

    assert "alice@example.com" not in root_stream.getvalue()
    assert "[redacted-email]" in root_stream.getvalue()


def test_non_pii_message_passes_through_unchanged() -> None:
    logger, stream = _make_logger("test.scrub.clean")
    logger.handlers[0].addFilter(PiiScrubbingFilter())

    logger.info("release run %s halted at Gate #1", "abc-123")

    assert "release run abc-123 halted at Gate #1" in stream.getvalue()
