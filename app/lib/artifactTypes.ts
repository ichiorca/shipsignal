// T4 (spec 007) / T1-T2 (spec 022) — canonical artifact-type metadata shared by the
// draft-list and Gate #2 review surfaces, the run-creation boundary, and the per-run
// selection UI (PRD §8.1 initial types). One source of truth for the closed type set, the
// human label, and the display order, so the multi-artifact review groups types
// consistently and a deferred type (§8.2) never gets a label here — if one ever surfaces
// it falls back to its raw id, making the anomaly visible rather than hidden. Pure data +
// helpers; no client/secret concerns (the form imports this client-side).

/** The closed §8.1 artifact-type vocabulary, as a literal union.
 *  customer_email + battlecard_delta added by operator decision 2026-06-09 (PRD §8.1;
 *  migration 0023 widens the DB CHECK in lockstep).
 *  x_post + hackernews_post added by Path B / Phase 2 (the tagline's "Hacker News, X" channels;
 *  migration 0026 widens the CHECK to ten). HN content is generated here; publishing it is
 *  assisted, not automatic (operator decision 2026-06-15). */
export type ArtifactType =
  | 'release_blog'
  | 'changelog_entry'
  | 'sales_onepager'
  | 'linkedin_post'
  | 'demo_script'
  | 'release_audio_digest'
  | 'customer_email'
  | 'battlecard_delta'
  | 'x_post'
  | 'hackernews_post';

/** The full initial artifact set (PRD §8.1 + Path B additions), in canonical order. */
export const ALL_ARTIFACT_TYPES: readonly ArtifactType[] = [
  'release_blog',
  'changelog_entry',
  'sales_onepager',
  'linkedin_post',
  'demo_script',
  'release_audio_digest',
  'customer_email',
  'battlecard_delta',
  'x_post',
  'hackernews_post',
];

export function isArtifactType(value: string): value is ArtifactType {
  return (ALL_ARTIFACT_TYPES as readonly string[]).includes(value);
}

/** The full initial artifact set (PRD §8.1), in the order the dashboard groups them. */
export const ARTIFACT_TYPE_ORDER: readonly string[] = ALL_ARTIFACT_TYPES;

/** T2 (spec 022) — parse the ARTIFACT_TYPES_DEFAULT env value (comma-separated §8.1 type
 *  ids) into the default selection for webhook-created runs. Unset/blank → all six.
 *  Unknown ids, duplicates, or an explicit-but-empty list THROW so a misconfigured
 *  deployment fails at startup rather than silently generating the wrong artifact set.
 *  Pure (the caller passes the env value) so the boundary is unit-testable. */
export function parseArtifactTypesDefault(raw: string | undefined): readonly ArtifactType[] {
  if (raw === undefined || raw.trim() === '') {
    return ALL_ARTIFACT_TYPES;
  }
  const entries = raw.split(',').map((entry) => entry.trim());
  const selected: ArtifactType[] = [];
  for (const entry of entries) {
    if (entry === '' || !isArtifactType(entry)) {
      throw new Error(
        `ARTIFACT_TYPES_DEFAULT contains an unknown artifact type: "${entry}" ` +
          `(expected a comma-separated subset of: ${ALL_ARTIFACT_TYPES.join(', ')})`,
      );
    }
    if (selected.includes(entry)) {
      throw new Error(`ARTIFACT_TYPES_DEFAULT lists "${entry}" more than once`);
    }
    selected.push(entry);
  }
  return selected;
}

/** Human label per initial artifact type; unknown/deferred types fall back to the raw id. */
const TYPE_LABELS: Readonly<Record<string, string>> = {
  release_blog: 'Release blog',
  changelog_entry: 'Changelog entry',
  sales_onepager: 'Sales one-pager',
  linkedin_post: 'LinkedIn / social post',
  demo_script: 'Demo script',
  release_audio_digest: 'Release audio digest',
  customer_email: 'Customer email announcement',
  battlecard_delta: 'Sales battlecard delta',
  x_post: 'X (Twitter) post',
  hackernews_post: 'Hacker News post (Show HN)',
};

export function typeLabel(artifactType: string): string {
  return TYPE_LABELS[artifactType] ?? artifactType;
}

/** Group items by their artifact type, returning groups in ARTIFACT_TYPE_ORDER first, then any
 *  unknown types in first-seen order — so the review surface is deterministic and complete. */
export function groupByType<T>(
  items: readonly T[],
  typeOf: (item: T) => string,
): readonly { readonly type: string; readonly items: readonly T[] }[] {
  const byType = new Map<string, T[]>();
  for (const item of items) {
    const type = typeOf(item);
    const list = byType.get(type) ?? [];
    list.push(item);
    byType.set(type, list);
  }
  const ordered = [
    ...ARTIFACT_TYPE_ORDER.filter((t) => byType.has(t)),
    ...[...byType.keys()].filter((t) => !ARTIFACT_TYPE_ORDER.includes(t)),
  ];
  return ordered.map((type) => ({ type, items: byType.get(type) ?? [] }));
}
