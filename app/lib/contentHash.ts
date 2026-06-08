// T1 (spec 016) — the canonical artifact content hash (§18.3 audit-trail "artifact hash").
// P5 (Safety rails) / §18.3: every artifact stores a tamper-evident hash of its content, and the
// approved-content snapshot (T2) records a STABLE hash of the final approved body. The dashboard
// recomputes it on a reviewer edit ("hash on update") and at approval; the worker mints it on
// generation. The canonicalization is fixed identically across all three surfaces — this file,
// worker/.../content_hash.py, and the SQL backfill in migration 0015:
//
//     sha256( utf-8( title + "\n\n" + body_markdown ) )  -> lowercase hex
//
// A null/undefined title canonicalizes to '' (matching coalesce(title,'') in SQL and `title or ''`
// in Python) so a draft without a title still hashes deterministically.

import { createHash } from 'node:crypto';

// Mirrors content_hash.py `_SEPARATOR` and the SQL E'\n\n'.
const SEPARATOR = '\n\n';

/** Lowercase-hex SHA-256 of an artifact's canonical content (§18.3 artifact hash). Deterministic:
 *  same (title, body) → same digest, identical to the worker and SQL recompute. */
export function artifactContentHash(title: string | null | undefined, bodyMarkdown: string): string {
  const preImage = `${title ?? ''}${SEPARATOR}${bodyMarkdown}`;
  return createHash('sha256').update(preImage, 'utf8').digest('hex');
}
