"""T3 (spec 002) — deterministic redaction/normalize of personal data and secrets.

Constitution §5 (Safety rails) + domain-gdpr-rules: evidence excerpts pass through
this module BEFORE they enter S3, Aurora, LangGraph state, or any Bedrock prompt.
Redaction is purely deterministic (regex-based, no model call) so it is reproducible
and unit-testable, and idempotent (redacting already-redacted text is a no-op) so a
double-pass can never re-expose data.

Pure stdlib (``re`` only) so the unit-test gate imports it without langgraph/psycopg/
boto3 installed. Each rule that fires contributes a stable ``risk_flag`` so reviewers
can see *why* an excerpt was modified.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Each rule: (risk_flag, compiled pattern, replacement placeholder). Order matters —
# more specific secret patterns run before the generic key/value catch-all so a
# GitHub token isn't merely flagged as a generic secret. Patterns are intentionally
# conservative (favor a false positive redaction over leaking) per "redact before
# persist": when in doubt, strip it.
_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
# IPv4 — personal data under GDPR. Bounded octets to avoid matching version strings.
_IPV4 = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b"
)
# IPv6 — also personal data under GDPR. The comprehensive form covers full, compressed
# (``::``), and leading/trailing-``::`` shapes. Every alternative needs either 7 colon
# groups or a ``::`` run, so single-colon prose like ``db:5432`` or ``12:34:56`` clocks
# are NOT matched (bias is to redact addresses, not over-match host:port / timestamps).
_IPV6 = re.compile(
    r"(?<![\w:.])(?:"
    r"(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}"
    r"|(?:[0-9A-Fa-f]{1,4}:){1,7}:"
    r"|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}"
    r"|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}"
    r"|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}"
    r"|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}"
    r"|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}"
    r"|[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}"
    r"|:(?:(?::[0-9A-Fa-f]{1,4}){1,7}|:)"
    r")(?![\w:.])"
)
# Phone numbers — personal data. Grouped digits (optional ``+`` prefix, optional parens,
# then space/dot/dash-separated chunks). The regex only proposes candidates; a callback
# enforces 7–15 total digits AND a real phone separator (``+``/space/dash/paren) so plain
# version numbers and dot-only quads (``3.2.3.0``) and bare commit counts never match.
_PHONE = re.compile(
    r"(?<![\w.])\+?(?:\(\d{1,4}\)|\d{1,4})(?:[\s.\-]\d{1,4}){1,6}"
)
_PHONE_SEPARATOR = re.compile(r"[()\s\-]")
_PRIVATE_KEY_BLOCK = re.compile(
    r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----.*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----",
    re.DOTALL,
)
# Truncated PRIVATE KEY: a BEGIN line followed by base64-looking lines but WITHOUT the
# closing ``-----END-----`` (common when a key spills across split diff hunks). Runs AFTER
# the full-block rule, so a complete block is already redacted and only orphaned BEGINs
# reach here. Base64 lines tolerate a leading diff marker (``+``) since ``+`` is base64.
_PRIVATE_KEY_TRUNCATED = re.compile(
    r"(?m)^.*-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----.*$"
    r"(?:\n[ \t]*[A-Za-z0-9+/=]{8,}[ \t]*)*"
)
_AWS_ACCESS_KEY = re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")
_GITHUB_TOKEN = re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b")
_GITHUB_PAT = re.compile(r"\bgithub_pat_[A-Za-z0-9_]{22,}\b")
_SLACK_TOKEN = re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b")
_BEARER = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._\-]{8,}")
# Unlabeled provider secrets — caught by shape, before the generic kv catch-all so they
# get a specific flag rather than merely "secret:credential" (and so a bare token with no
# ``key=`` prefix is still stripped).
_STRIPE_LIVE_KEY = re.compile(r"\bsk_live_[A-Za-z0-9]{16,}\b")
_GOOGLE_API_KEY = re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")
_JWT = re.compile(r"\beyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+")
# Generic "key = secret" assignments (api_key, secret, token, password, xi-api-key).
# Captures the key name (group 1) so the placeholder keeps the field readable.
_KV_SECRET = re.compile(
    r"(?i)\b([\w\-]*(?:api[_\-]?key|secret|token|password|passwd|pwd))\b"
    r"\s*[:=]\s*[\"']?([A-Za-z0-9._\-/+]{6,})[\"']?"
)

# (risk_flag, pattern, replacement). Replacement may be a string or a callable for
# rules that preserve a captured field name.
_PLACEHOLDER_EMAIL = "[redacted-email]"
_PLACEHOLDER_IP = "[redacted-ip]"
_PLACEHOLDER_PHONE = "[redacted-phone]"

# A 4-part dotted number is ambiguous: a real IPv4 vs a 4-segment version (e.g. 3.2.3.0, all-valid
# octets). When the dotted-quad is the value of a version-style ASSIGNMENT we keep it: redacting
# build metadata like `S6_OVERLAY_VERSION=3.2.3.0` is lossy and a personal IP is implausible in that
# context. The check is intentionally narrow — an explicit `version`/`revision`/`ver` keyword
# FOLLOWED BY `:` or `=` immediately before the value. Bare prose keywords (`release`, `build`,
# `tag`) no longer exempt a dotted-quad, so a real IP in `release 10.0.0.5` is still redacted.
_VERSION_CONTEXT = re.compile(
    r"(?i)(?:version|revision|_ver\b|\bver\b)\s*[:=]\s*[\"']?$"
)


def _kv_replacement(match: re.Match[str]) -> str:
    return f"{match.group(1)}=[redacted-secret]"


@dataclass(frozen=True, slots=True)
class RedactionResult:
    """The outcome of redacting one excerpt.

    Attributes:
        text: the redacted, normalized excerpt — safe to persist.
        risk_flags: sorted, de-duplicated flags for every rule that fired.
    """

    text: str
    risk_flags: tuple[str, ...]


def _normalize(text: str) -> str:
    """Normalize line endings and strip trailing whitespace per line.

    Normalization is part of the redact node (PRD §5.2 "redact and normalize") and
    keeps stored excerpts diff-stable regardless of the source's CRLF/whitespace.
    """
    unix = text.replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.rstrip() for line in unix.split("\n"))


def redact(text: str) -> RedactionResult:
    """Strip personal data and secrets from ``text`` deterministically.

    Returns the redacted+normalized text and the set of risk flags raised. Idempotent:
    ``redact(redact(t).text).risk_flags`` is empty because the placeholders contain no
    matchable PII/secret.
    """
    flags: set[str] = set()

    def sub(flag: str, pattern: re.Pattern[str], repl: str, src: str) -> str:
        out, n = pattern.subn(repl, src)
        if n:
            flags.add(flag)
        return out

    redacted = text
    # Most-specific secret shapes first, then generic kv, then PII. The full private-key
    # block runs before the truncated fallback so a complete block is matched whole and
    # only an orphaned BEGIN (split across diff hunks) falls through to the fallback.
    redacted = sub(
        "secret:private_key", _PRIVATE_KEY_BLOCK, "[redacted-private-key]", redacted
    )
    redacted = sub(
        "secret:private_key",
        _PRIVATE_KEY_TRUNCATED,
        "[redacted-private-key]",
        redacted,
    )
    redacted = sub(
        "secret:aws_access_key", _AWS_ACCESS_KEY, "[redacted-secret]", redacted
    )
    redacted = sub("secret:github_token", _GITHUB_TOKEN, "[redacted-secret]", redacted)
    redacted = sub("secret:github_token", _GITHUB_PAT, "[redacted-secret]", redacted)
    redacted = sub("secret:slack_token", _SLACK_TOKEN, "[redacted-secret]", redacted)
    redacted = sub("secret:bearer", _BEARER, "Bearer [redacted-secret]", redacted)
    redacted = sub(
        "secret:stripe_key", _STRIPE_LIVE_KEY, "[redacted-secret]", redacted
    )
    redacted = sub(
        "secret:google_api_key", _GOOGLE_API_KEY, "[redacted-secret]", redacted
    )
    redacted = sub("secret:jwt", _JWT, "[redacted-secret]", redacted)

    out, n = _KV_SECRET.subn(_kv_replacement, redacted)
    if n:
        flags.add("secret:credential")
    redacted = out

    redacted = sub("email", _EMAIL, _PLACEHOLDER_EMAIL, redacted)

    # IPv4 is context-aware: a dotted-quad that is the value of a version assignment is a version
    # number, not an address, so it is preserved. Every other dotted-quad is redacted (and flagged).
    ip_hits = 0

    def _ip_sub(match: re.Match[str]) -> str:
        nonlocal ip_hits
        before = match.string[: match.start()]
        line_left = before[before.rfind("\n") + 1 :]
        if _VERSION_CONTEXT.search(line_left):
            return match.group(
                0
            )  # keep version numbers like S6_OVERLAY_VERSION=3.2.3.0
        ip_hits += 1
        return _PLACEHOLDER_IP

    redacted = _IPV4.sub(_ip_sub, redacted)
    # IPv6 shares the "ip" flag + placeholder; no version-context exemption applies (a
    # version string is never colon-grouped hex). Run after IPv4 so a dotted-quad is
    # already gone before phone grouping sees the digits.
    redacted, ipv6_hits = _IPV6.subn(_PLACEHOLDER_IP, redacted)
    if ip_hits or ipv6_hits:
        flags.add("ip")

    phone_hits = 0

    def _phone_sub(match: re.Match[str]) -> str:
        nonlocal phone_hits
        raw = match.group(0)
        digit_count = sum(c.isdigit() for c in raw)
        # Require phone-like length and a real separator: a dot-only run with no `+` is a
        # version/quad, not a phone, so leave it for the IP rule (or as-is).
        if not (7 <= digit_count <= 15):
            return raw
        if "+" not in raw and not _PHONE_SEPARATOR.search(raw):
            return raw
        phone_hits += 1
        return _PLACEHOLDER_PHONE

    redacted = _PHONE.sub(_phone_sub, redacted)
    if phone_hits:
        flags.add("phone")

    return RedactionResult(text=_normalize(redacted), risk_flags=tuple(sorted(flags)))
