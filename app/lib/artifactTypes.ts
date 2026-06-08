// T4 (spec 007) — canonical artifact-type metadata shared by the draft-list and Gate #2
// review surfaces (PRD §8.1 initial types). One source of truth for the human label and the
// display order, so the multi-artifact review groups types consistently and a deferred type
// (§8.2) never gets a label here — if one ever surfaces it falls back to its raw id, making the
// anomaly visible rather than hidden. Pure data + helpers; no client/secret concerns.

/** The full initial artifact set (PRD §8.1), in the order the dashboard groups them. */
export const ARTIFACT_TYPE_ORDER: readonly string[] = [
  'release_blog',
  'changelog_entry',
  'sales_onepager',
  'linkedin_post',
  'demo_script',
  'release_audio_digest',
];

/** Human label per initial artifact type; unknown/deferred types fall back to the raw id. */
const TYPE_LABELS: Readonly<Record<string, string>> = {
  release_blog: 'Release blog',
  changelog_entry: 'Changelog entry',
  sales_onepager: 'Sales one-pager',
  linkedin_post: 'LinkedIn / social post',
  demo_script: 'Demo script',
  release_audio_digest: 'Release audio digest',
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
