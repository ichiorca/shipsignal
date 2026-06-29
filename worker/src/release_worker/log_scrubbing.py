"""T4 (spec 010) — PII-scrubbing logging filter (no personal data in telemetry/logs).

P5 (Safety rails) / domain-gdpr-rules + security-baseline: "NEVER log, print, or persist raw
personal data" and "no PII in telemetry or logs". The worker already logs with lazy %-style
args and never logs evidence bodies, but a defense-in-depth filter guarantees the invariant
even if a future log call interpolates an email, IP, or secret: every record is passed
through the SAME deterministic redactor that guards the evidence pipeline (``redaction.redact``)
before a handler emits it.

Attach ``PiiScrubbingFilter`` to the root logger (done in ``__main__`` /
``release_worker.privacy``) so it covers every module's records. The scrub happens on the
*final* message (args already interpolated), so it catches PII whether it arrived via the
format string or a ``%s`` arg.

Pure stdlib + the in-repo redactor — no new dependency.
"""

from __future__ import annotations

import logging

from release_worker.redaction import redact

# A bare formatter reused only to render exc_info → text (no format string needed). The
# render is deterministic and stateless, so a module-level instance is safe to share.
_EXC_FORMATTER = logging.Formatter()


class PiiScrubbingFilter(logging.Filter):
    """A ``logging.Filter`` that redacts PII/secrets from every record before it is emitted.

    Returns ``True`` always (it scrubs, never drops). It interpolates the record's args itself
    and clears them so the downstream handler emits the already-scrubbed text verbatim — the
    raw email/IP/secret never reaches a handler, a file, or a telemetry sink. The same scrub is
    applied to the rendered exception traceback and stack info, which routinely embed the raw
    offending value (an email/IP/secret in a repr or message) on ``logger.exception(...)`` /
    ``exc_info=True``.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        # getMessage() applies record.args to record.msg; redact the fully-rendered line, then
        # clear args so the handler doesn't re-interpolate (which would re-introduce raw args).
        rendered = record.getMessage()
        record.msg = redact(rendered).text
        record.args = ()
        # Tracebacks bypass the message scrub entirely: render exc_info once into exc_text and
        # clear exc_info so the handler emits the scrubbed text instead of re-formatting the live
        # exception. Idempotent — a second pass finds exc_info already cleared and exc_text holds
        # only placeholders. Guarded so a record with no exception/stack never crashes.
        if record.exc_info:
            if record.exc_text is None:
                record.exc_text = _EXC_FORMATTER.formatException(record.exc_info)
            record.exc_info = None
        if record.exc_text is not None:
            record.exc_text = redact(record.exc_text).text
        if record.stack_info is not None:
            record.stack_info = redact(record.stack_info).text
        return True


def install_pii_scrubbing(logger: logging.Logger | None = None) -> PiiScrubbingFilter:
    """Attach a ``PiiScrubbingFilter`` to every handler of ``logger`` (root by default).

    Wired once at process start (after ``logging.basicConfig`` has created the root handler).
    The filter goes on the HANDLERS, not the logger: a logger-level filter is skipped for
    records that propagate up from child loggers (e.g. ``release_worker.*``), whereas a
    handler-level filter runs for every record that reaches the handler — including propagated
    ones — so the scrub is genuinely process-wide. Returns the installed filter.
    """
    target = logger if logger is not None else logging.getLogger()
    scrubber = PiiScrubbingFilter()
    for handler in target.handlers:
        handler.addFilter(scrubber)
    return scrubber
