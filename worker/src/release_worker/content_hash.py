"""T1 (spec 016) — the canonical artifact content hash (§18.3 audit-trail "artifact hash").

P5 (Safety rails) / §18.3: every artifact must store a tamper-evident hash of its content, and
the approved-content snapshot (T2) must record a STABLE hash of the final approved body. The hash
must be reproducible across the Python worker (which mints it on generation) and the TypeScript
dashboard (which recomputes it on a reviewer edit and at approval), so the canonicalization is
fixed here and mirrored byte-for-byte in ``app/lib/contentHash.ts`` and the SQL backfill in
migration ``0015_artifact_content_hash``:

    sha256( utf-8( title + "\\n\\n" + body_markdown ) )  -> lowercase hex

A missing title canonicalizes to the empty string (``coalesce(title,'')`` in SQL) so a draft
without a title still hashes deterministically. Pure stdlib (``hashlib``) so the unit gate imports
it without langgraph/psycopg/boto3 — and so the hash is purely a function of the content, never of
a row id or wall-clock (stable across retries / re-reads).
"""

from __future__ import annotations

import hashlib

# The separator between title and body in the canonical pre-image. Mirrored in
# app/lib/contentHash.ts (`${title}\n\n${body}`) and the SQL backfill (E'\n\n').
_SEPARATOR = "\n\n"


def artifact_content_hash(title: str | None, body_markdown: str) -> str:
    """Return the lowercase-hex SHA-256 of an artifact's canonical content (§18.3 artifact hash).

    Deterministic and reproducible: the same ``(title, body)`` always yields the same digest, so
    the hash is stable across retries and identical to the value the dashboard recomputes on an
    edit/approval. ``title`` of ``None`` is treated as the empty string.
    """
    pre_image = f"{title or ''}{_SEPARATOR}{body_markdown}"
    return hashlib.sha256(pre_image.encode("utf-8")).hexdigest()
