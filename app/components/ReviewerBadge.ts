// UI tier-2 #5 — surface the reviewer identity globally. The reviewer name is persisted across
// the three gates (sessionStorage via useReviewerName); showing "Reviewing as: <name>" in the
// header means it is set once and always visible, instead of an empty field greeting you on each
// gate screen. Renders nothing until a name has been entered (no clutter for a fresh session).
// Initial render is empty on both server and client (the hook hydrates from storage in an
// effect), so there is no hydration mismatch.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free harness.

'use client';

import { createElement } from 'react';
import type { ReactElement } from 'react';
import { useReviewerName } from '../lib/useReviewerName.ts';

export function ReviewerBadge(): ReactElement | null {
  const [reviewer] = useReviewerName();
  if (reviewer.trim() === '') return null;
  return createElement(
    'span',
    { 'data-reviewer-badge': true },
    'Reviewing as: ',
    createElement('strong', null, reviewer),
  );
}
