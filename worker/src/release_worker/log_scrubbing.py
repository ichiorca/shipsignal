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


class PiiScrubbingFilter(logging.Filter):
    """A ``logging.Filter`` that redacts PII/secrets from every record before it is emitted.

    Returns ``True`` always (it scrubs, never drops). It interpolates the record's args itself
    and clears them so the downstream handler emits the already-scrubbed text verbatim — the
    raw email/IP/secret never reaches a handler, a file, or a telemetry sink.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        # getMessage() applies record.args to record.msg; redact the fully-rendered line, then
        # clear args so the handler doesn't re-interpolate (which would re-introduce raw args).
        rendered = record.getMessage()
        record.msg = redact(rendered).text
        record.args = ()
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
