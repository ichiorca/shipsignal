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


def test_filter_scrubs_pii_from_exception_tracebacks() -> None:
    """logger.exception(...) renders a traceback that embeds the raw offending value (here
    in the exception message). The filter must scrub the rendered traceback, not just the
    log message, or the email/token leaks into the handler verbatim."""
    # Arrange: a handler that emits both message and traceback.
    logger, stream = _make_logger("test.scrub.exc")
    handler = logger.handlers[0]
    handler.setFormatter(logging.Formatter("%(message)s\n%(exc_text)s"))
    handler.addFilter(PiiScrubbingFilter())

    # Act: raise an exception whose message carries an email + a token, then log it.
    try:
        raise ValueError("contact alice@example.com token=AKIAIOSFODNN7EXAMPLE")
    except ValueError:
        logger.exception("operation failed for owner alice@example.com")

    # Assert: neither the email nor the token survives anywhere in the emitted text.
    out = stream.getvalue()
    assert "alice@example.com" not in out
    assert "AKIAIOSFODNN7EXAMPLE" not in out
    assert "[redacted-email]" in out
    assert "ValueError" in out  # the traceback itself is still emitted (scrubbed)


def test_filter_scrubs_stack_info() -> None:
    """stack_info=True attaches a rendered stack; PII referenced there must be scrubbed."""
    logger, stream = _make_logger("test.scrub.stack")
    handler = logger.handlers[0]
    handler.setFormatter(logging.Formatter("%(message)s\n%(stack_info)s"))
    handler.addFilter(PiiScrubbingFilter())

    logger.info("ping from 10.0.0.5", stack_info=True)

    out = stream.getvalue()
    assert "10.0.0.5" not in out
    assert "[redacted-ip]" in out


def test_filter_is_idempotent_on_exception_records() -> None:
    """Running the filter twice on the same record must not crash or re-expose anything."""
    scrubber = PiiScrubbingFilter()
    try:
        raise ValueError("leak alice@example.com")
    except ValueError:
        record = logging.LogRecord(
            name="t",
            level=logging.ERROR,
            pathname=__file__,
            lineno=1,
            msg="boom %s",
            args=("alice@example.com",),
            exc_info=__import__("sys").exc_info(),
        )

    assert scrubber.filter(record) is True
    assert scrubber.filter(record) is True  # second pass is a no-op, not a crash
    assert "alice@example.com" not in record.getMessage()
    assert record.exc_text is not None
    assert "alice@example.com" not in record.exc_text
