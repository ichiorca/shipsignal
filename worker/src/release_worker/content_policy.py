"""T3 (spec 016) — named deterministic content checks (§12.3 / §18.1, §18.2 layer 2).

Constitution §5 (Safety rails) + §18.1 (separation of internal vs publishable truth): a generated
artifact must never expose codenames, customer names, private/internal URLs, internal hostnames,
or security-implementation details. The PRD §12.3 list existed only as a *prompt instruction*;
this module makes the named checks **code** that runs during pre-review artifact validation (layer
2), independent of Bedrock Guardrails. The checks fail closed — a hit is BLOCKING at the caller, so
a leak can never reach Gate #2 approval.

Purely deterministic (regex + configured word lists, no model call) so it is reproducible and
unit-testable, and pure stdlib (``re``/``json``/``pathlib``/``dataclasses``) so the unit gate
imports it without langgraph/psycopg/boto3. Findings are user-safe: a check reports only WHICH
category fired (a stable code), never the matched value.

§ "Lists are configurable" (AC5): codenames, customer names, and extra internal hostnames /
security terms are **project-supplied** via a JSON file (``CONTENT_POLICY_PATH``), not hardcoded to
one tenant. The pattern-based checks (private URL, internal-TLD hostname) and a conservative
default security-term floor run even with no config, so the layer-2 gate is never empty.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

# Stable finding codes (also the §12.3 category names). The caller turns each into a BLOCKING
# PolicyFinding; the value that matched is NEVER included (constitution §5 — user-safe detail).
CODE_CODENAME = "codename"
CODE_CUSTOMER_NAME = "customer_name"
CODE_PRIVATE_URL = "private_url"
CODE_INTERNAL_HOSTNAME = "internal_hostname"
CODE_SECURITY_DETAIL = "security_detail"

# Conservative default floor for "security-implementation details" (§18.1). These are phrasings
# that should never appear in polished publishable copy; a project can ADD to this via config but
# never silently below it. Whole-word/phrase matched, case-insensitive.
_DEFAULT_SECURITY_TERMS: tuple[str, ...] = (
    "private key",
    "secret key",
    "encryption key",
    "signing key",
    "hardcoded password",
    "hardcoded secret",
    "auth bypass",
    "authentication bypass",
    "privilege escalation",
    "backdoor",
    "sql injection",
    "remote code execution",
)

# Internal/non-public TLDs (RFC 6762 .local, common corp suffixes, k8s .svc). A hostname ending in
# one of these is internal infrastructure that must not be published.
_INTERNAL_TLD = r"(?:internal|corp|local|lan|intranet|svc)"
# RFC1918 + loopback ranges — a URL pointing at one of these is a private endpoint.
_RFC1918 = (
    r"(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
    r"|192\.168\.\d{1,3}\.\d{1,3}"
    r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
    r"|127\.\d{1,3}\.\d{1,3}\.\d{1,3})"
)
# A http(s) URL whose host is an internal TLD, an RFC1918/loopback IP, or localhost.
_PRIVATE_URL = re.compile(
    rf"(?i)\bhttps?://(?:[a-z0-9.-]+\.{_INTERNAL_TLD}\b|{_RFC1918}|localhost)"
)
# A bare internal hostname (≥1 label then an internal TLD), with or without a scheme.
_INTERNAL_HOST = re.compile(rf"(?i)\b(?:[a-z0-9-]+\.)+{_INTERNAL_TLD}\b")


@dataclass(frozen=True, slots=True)
class NamedEntityPolicy:
    """Project-supplied lists for the named deterministic checks (AC5 — not tenant-hardcoded).

    ``codenames`` / ``customer_names`` are whole-word/phrase matched case-insensitively;
    ``internal_hostnames`` are exact hosts to flag in addition to the internal-TLD pattern; and
    ``security_terms`` extends (never replaces) the default floor. An empty policy still runs the
    pattern-based private-URL / internal-TLD / default-security checks.
    """

    codenames: tuple[str, ...] = ()
    customer_names: tuple[str, ...] = ()
    internal_hostnames: tuple[str, ...] = ()
    security_terms: tuple[str, ...] = field(default=_DEFAULT_SECURITY_TERMS)


def _phrase_pattern(terms: tuple[str, ...]) -> re.Pattern[str] | None:
    """Compile a case-insensitive whole-word alternation over ``terms`` (escaped), or None.

    ``(?<!\\w)``/``(?!\\w)`` bound each term so ``Titan`` matches ``Project Titan`` but not
    ``titanium``; multi-word phrases match across a single space. Returns None for an empty list so
    an absent config contributes no check."""
    cleaned = [re.escape(t.strip()) for t in terms if t.strip()]
    if not cleaned:
        return None
    body = "|".join(sorted(cleaned, key=len, reverse=True))
    return re.compile(rf"(?i)(?<!\w)(?:{body})(?!\w)")


def _hostname_pattern(hosts: tuple[str, ...]) -> re.Pattern[str] | None:
    """Compile an exact-host alternation (escaped, dot-bounded) over configured internal hosts."""
    cleaned = [re.escape(h.strip()) for h in hosts if h.strip()]
    if not cleaned:
        return None
    body = "|".join(sorted(cleaned, key=len, reverse=True))
    return re.compile(rf"(?i)(?<![\w.])(?:{body})(?![\w.])")


def scan_named_entities(text: str, policy: NamedEntityPolicy) -> tuple[str, ...]:
    """Return the sorted set of named-check codes that fired in ``text`` (never the matched value).

    Runs the §12.3/§18.1 named checks deterministically:
      * configured codenames / customer names (whole-word, case-insensitive);
      * private URLs (http(s) to an internal TLD, RFC1918/loopback IP, or localhost);
      * internal hostnames (internal-TLD pattern + any configured exact hosts);
      * security-implementation terms (default floor + configured additions).
    A clean excerpt returns ``()``. The caller raises one BLOCKING finding per returned code.
    """
    flags: set[str] = set()

    codename_re = _phrase_pattern(policy.codenames)
    if codename_re is not None and codename_re.search(text):
        flags.add(CODE_CODENAME)

    customer_re = _phrase_pattern(policy.customer_names)
    if customer_re is not None and customer_re.search(text):
        flags.add(CODE_CUSTOMER_NAME)

    if _PRIVATE_URL.search(text):
        flags.add(CODE_PRIVATE_URL)

    if _INTERNAL_HOST.search(text):
        flags.add(CODE_INTERNAL_HOSTNAME)
    else:
        host_re = _hostname_pattern(policy.internal_hostnames)
        if host_re is not None and host_re.search(text):
            flags.add(CODE_INTERNAL_HOSTNAME)

    security_re = _phrase_pattern(policy.security_terms)
    if security_re is not None and security_re.search(text):
        flags.add(CODE_SECURITY_DETAIL)

    return tuple(sorted(flags))


def load_named_entity_policy(path: str | None = None) -> NamedEntityPolicy:
    """Load the project-supplied policy from a JSON file (``CONTENT_POLICY_PATH`` by default).

    The file is untrusted config: only string entries under ``codenames`` / ``customer_names`` /
    ``internal_hostnames`` / ``security_terms`` are accepted; ``security_terms`` EXTENDS the default
    floor (never drops below it). A missing/empty/malformed path yields the default policy so the
    layer-2 gate still runs the pattern-based checks (fail closed, never fail open).
    """
    resolved = path if path is not None else os.environ.get("CONTENT_POLICY_PATH")
    if not resolved:
        return NamedEntityPolicy()
    config_path = Path(resolved)
    if not config_path.is_file():
        return NamedEntityPolicy()
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return NamedEntityPolicy()
    if not isinstance(raw, dict):
        return NamedEntityPolicy()

    def _strs(key: str) -> tuple[str, ...]:
        value = raw.get(key)
        if not isinstance(value, list):
            return ()
        return tuple(v for v in value if isinstance(v, str) and v.strip())

    return NamedEntityPolicy(
        codenames=_strs("codenames"),
        customer_names=_strs("customer_names"),
        internal_hostnames=_strs("internal_hostnames"),
        # Extend the default floor; configured terms can add to but never weaken it.
        security_terms=_DEFAULT_SECURITY_TERMS + _strs("security_terms"),
    )
