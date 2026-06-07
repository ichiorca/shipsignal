// T5 (spec 003) — categorized signal view for the run-detail page (PRD §6.2/§6.3).
// Groups a run's evidence by `evidence_type` with per-group counts and average
// confidence, so a reviewer sees the release as typed signals (ui_string_change,
// route, schema_change, …) rather than a flat list.
//
// P6 (Quality bars / WCAG 2.2 AA): a semantic summary <table> (caption + column
// headers) whose Type cells are in-page <a href="#group-…"> links, plus one native
// <details>/<summary> disclosure per type. Disclosures are keyboard-operable filters
// with zero client JS (summary is focusable; Enter/Space toggles) — the whole view
// renders in a Server Component and stays axe-clean. constitution §4/§5: only redacted
// content is rendered; the component is typed against `EvidenceItem`, which carries no
// raw excerpt and no S3 URI.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` harness, mirroring EvidenceTable/RunListTable.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { EvidenceItem } from '@/app/lib/db/evidenceItems.ts';

export interface CategorizedSignalsProps {
  readonly items: readonly EvidenceItem[];
}

interface SignalGroup {
  readonly type: string;
  readonly items: readonly EvidenceItem[];
  readonly avgConfidence: number | null;
}

const ITEM_HEADERS = ['File', 'Redacted excerpt', 'Confidence', 'Line'] as const;

function truncate(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function formatConfidence(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function lineOf(item: EvidenceItem): string {
  const raw = item.metadata['line_range'];
  return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '—';
}

/** Group by evidence_type, sorted by descending count then type name for a stable,
 *  deterministic order regardless of row arrival order. */
function groupByType(items: readonly EvidenceItem[]): readonly SignalGroup[] {
  const buckets = new Map<string, EvidenceItem[]>();
  for (const item of items) {
    const bucket = buckets.get(item.evidence_type);
    if (bucket === undefined) {
      buckets.set(item.evidence_type, [item]);
    } else {
      bucket.push(item);
    }
  }
  const groups: SignalGroup[] = [...buckets.entries()].map(([type, groupItems]) => {
    const scored = groupItems.filter((i): i is EvidenceItem & { confidence: number } =>
      i.confidence !== null,
    );
    const avgConfidence =
      scored.length === 0
        ? null
        : scored.reduce((sum, i) => sum + i.confidence, 0) / scored.length;
    return { type, items: groupItems, avgConfidence };
  });
  return groups.sort(
    (a, b) => b.items.length - a.items.length || a.type.localeCompare(b.type),
  );
}

function summaryRow(group: SignalGroup): ReactElement {
  return createElement(
    'tr',
    { key: group.type },
    createElement(
      'td',
      null,
      createElement('a', { href: `#group-${group.type}` }, group.type),
    ),
    createElement('td', null, String(group.items.length)),
    createElement('td', null, formatConfidence(group.avgConfidence)),
  );
}

function summaryTable(groups: readonly SignalGroup[]): ReactElement {
  return createElement(
    'table',
    null,
    createElement('caption', null, 'Signals by type'),
    createElement(
      'thead',
      null,
      createElement(
        'tr',
        null,
        createElement('th', { scope: 'col' }, 'Type'),
        createElement('th', { scope: 'col' }, 'Count'),
        createElement('th', { scope: 'col' }, 'Avg confidence'),
      ),
    ),
    createElement('tbody', null, groups.map(summaryRow)),
  );
}

function itemRow(item: EvidenceItem): ReactElement {
  return createElement(
    'tr',
    { key: item.id },
    createElement('td', null, item.file_path ?? '—'),
    createElement('td', null, truncate(item.redacted_excerpt)),
    createElement('td', null, formatConfidence(item.confidence)),
    createElement('td', null, lineOf(item)),
  );
}

function groupDisclosure(group: SignalGroup): ReactElement {
  return createElement(
    'details',
    { key: group.type, open: true },
    createElement(
      'summary',
      { id: `group-${group.type}` },
      `${group.type} (${group.items.length})`,
    ),
    createElement(
      'table',
      null,
      createElement('caption', null, `${group.type} evidence`),
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          ...ITEM_HEADERS.map((label) =>
            createElement('th', { key: label, scope: 'col' }, label),
          ),
        ),
      ),
      createElement('tbody', null, group.items.map(itemRow)),
    ),
  );
}

export function CategorizedSignals({ items }: CategorizedSignalsProps): ReactElement {
  const groups = groupByType(items);
  if (groups.length === 0) {
    return createElement(
      'section',
      { 'aria-label': 'Categorized signals' },
      createElement('p', null, 'No categorized signals for this run yet.'),
    );
  }
  return createElement(
    'section',
    { 'aria-label': 'Categorized signals' },
    summaryTable(groups),
    ...groups.map(groupDisclosure),
  );
}
