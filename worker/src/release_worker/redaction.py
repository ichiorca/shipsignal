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
_PRIVATE_KEY_BLOCK = re.compile(
    r"-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----.*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----",
    re.DOTALL,
)
_AWS_ACCESS_KEY = re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")
_GITHUB_TOKEN = re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b")
_GITHUB_PAT = re.compile(r"\bgithub_pat_[A-Za-z0-9_]{22,}\b")
_SLACK_TOKEN = re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b")
_BEARER = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._\-]{8,}")
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
    # Most-specific secret shapes first, then generic kv, then PII.
    redacted = sub(
        "secret:private_key", _PRIVATE_KEY_BLOCK, "[redacted-private-key]", redacted
    )
    redacted = sub(
        "secret:aws_access_key", _AWS_ACCESS_KEY, "[redacted-secret]", redacted
    )
    redacted = sub("secret:github_token", _GITHUB_TOKEN, "[redacted-secret]", redacted)
    redacted = sub("secret:github_token", _GITHUB_PAT, "[redacted-secret]", redacted)
    redacted = sub("secret:slack_token", _SLACK_TOKEN, "[redacted-secret]", redacted)
    redacted = sub("secret:bearer", _BEARER, "Bearer [redacted-secret]", redacted)

    out, n = _KV_SECRET.subn(_kv_replacement, redacted)
    if n:
        flags.add("secret:credential")
    redacted = out

    redacted = sub("email", _EMAIL, _PLACEHOLDER_EMAIL, redacted)
    redacted = sub("ip", _IPV4, _PLACEHOLDER_IP, redacted)

    return RedactionResult(text=_normalize(redacted), risk_flags=tuple(sorted(flags)))
