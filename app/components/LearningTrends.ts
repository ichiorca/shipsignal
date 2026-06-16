// Cross-run learning trend view (operator feedback 2026-06-09, priority 3): the moat
// slide — reviewer rewriting and feature rejection falling across runs while skill
// versions promote. Pure presentational component (no 'use client'; the page reads
// Aurora). P6 (WCAG 2.2 AA): the data lives in captioned semantic tables; the sparklines
// are decorative (aria-hidden) reinforcement, never the sole carrier.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import {
  percentCell,
  sparklinePoints,
  summarizeTrend,
  type RunTrendPoint,
  type SkillPromotionPoint,
} from '../lib/learningTrends.ts';

export interface LearningTrendsProps {
  readonly points: readonly RunTrendPoint[];
  readonly promotions: readonly SkillPromotionPoint[];
}

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function shortDate(iso: string | null): string {
  return iso === null ? '—' : iso.slice(0, 10);
}

function sparkline(values: readonly (number | null)[], label: string): ReactElement | null {
  const pts = sparklinePoints(values);
  if (pts === '') return null;
  return createElement(
    'svg',
    {
      viewBox: '0 0 200 40',
      width: 200,
      height: 40,
      'aria-hidden': true,
      'data-sparkline': label,
    },
    createElement('polyline', {
      points: pts,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
    }),
  );
}

export function LearningTrends({ points, promotions }: LearningTrendsProps): ReactElement {
  const editSeries = points.map((p) => p.edit_distance);
  const rejectionSeries = points.map((p) => p.feature_rejection_rate);
  const edit = summarizeTrend(editSeries, 'Reviewer rewriting (edit distance)');
  const rejection = summarizeTrend(rejectionSeries, 'Feature rejection rate');

  return createElement(
    'section',
    { 'aria-labelledby': 'learning-trends-heading', 'data-learning-trends': '' },
    createElement('h2', { id: 'learning-trends-heading' }, 'Self-learning trend'),
    createElement(
      'p',
      null,
      'Every reviewer edit and rejection feeds the skill-learning loop (Gate #3). ' +
        'These series should fall as promoted skill versions compound.',
    ),
    createElement(
      'p',
      { 'data-trend-headline': 'edit_distance', 'data-direction': edit.direction },
      edit.headline,
    ),
    sparkline(editSeries, 'edit_distance'),
    createElement(
      'p',
      { 'data-trend-headline': 'feature_rejection_rate', 'data-direction': rejection.direction },
      rejection.headline,
    ),
    sparkline(rejectionSeries, 'feature_rejection_rate'),
    createElement(
      'table',
      null,
      createElement('caption', null, 'Per-run learning metrics (oldest first)'),
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          createElement('th', { scope: 'col' }, 'Run'),
          createElement('th', { scope: 'col' }, 'Started'),
          createElement('th', { scope: 'col' }, 'Edit distance'),
          createElement('th', { scope: 'col' }, 'Feature rejection'),
        ),
      ),
      createElement(
        'tbody',
        null,
        ...points.map((p) =>
          createElement(
            'tr',
            { key: p.release_run_id },
            createElement(
              'th',
              { scope: 'row' },
              createElement('a', { href: `/releases/${p.release_run_id}` }, shortId(p.release_run_id)),
            ),
            createElement('td', null, shortDate(p.started_at)),
            createElement('td', null, percentCell(p.edit_distance)),
            createElement('td', null, percentCell(p.feature_rejection_rate)),
          ),
        ),
      ),
    ),
    points.length === 0
      ? createElement(
          'p',
          null,
          'No evaluated runs yet — run the eval step after a release completes review.',
        )
      : null,
    createElement(
      'table',
      null,
      createElement('caption', null, 'Promoted skill versions (Gate #3 approvals)'),
      createElement(
        'thead',
        null,
        createElement(
          'tr',
          null,
          createElement('th', { scope: 'col' }, 'Skill'),
          createElement('th', { scope: 'col' }, 'Version'),
          createElement('th', { scope: 'col' }, 'Promoted'),
        ),
      ),
      createElement(
        'tbody',
        null,
        ...promotions.map((promotion, index) =>
          createElement(
            'tr',
            { key: `${promotion.skill_name}-${promotion.proposed_version}-${index}` },
            createElement('th', { scope: 'row' }, promotion.skill_name),
            createElement('td', null, promotion.proposed_version),
            createElement('td', null, shortDate(promotion.reviewed_at)),
          ),
        ),
      ),
    ),
    promotions.length === 0
      ? createElement(
          'p',
          null,
          'No skill promotions yet — approve a skill candidate at Gate #3 to start the loop.',
        )
      : null,
  );
}
