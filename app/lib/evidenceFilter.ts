// Frontend audit (gap #2) — pure filter for the evidence table. The run-detail evidence list was
// rendered unbounded with no search; this holds the (DOM-free, server-only-free) text filter so the
// client EvidenceFeed wrapper and its `node --test` unit test share one implementation. Pagination
// reuses the generic `paginate` from runFeedFilter.ts. constitution §5: operates only on the
// already-redacted EvidenceItem view (no raw excerpt, no S3 URI).

import type { EvidenceItem } from '@/app/lib/db/evidenceItems.ts';

/** Case-insensitive substring match across the human-meaningful evidence fields: file path,
 *  evidence type, source, symbol name, and the redacted excerpt. */
export function filterEvidence(
  items: readonly EvidenceItem[],
  query: string,
): readonly EvidenceItem[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return items;
  return items.filter((item) => {
    const haystack = [
      item.file_path ?? '',
      item.evidence_type,
      item.source,
      item.symbol_name ?? '',
      item.redacted_excerpt,
      item.risk_flags.join(' '),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}
