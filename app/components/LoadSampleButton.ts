// "Load sample release" (operator feedback 2026-06-09, priority 5): one click seeds a
// synthetic, fully-populated run — time-to-wow in seconds, and a live demo that no missing
// GitHub token or Actions runner can kill. P6 (WCAG 2.2 AA): a real <button>, disabled
// while pending, with a polite live region announcing the result and a link into the run.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components. "use client": interactive
// leaf; it only calls the public seed API — no secret or DB handle here.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';

type SeedResult =
  | { readonly kind: 'idle' }
  | { readonly kind: 'seeded'; readonly runId: string }
  | { readonly kind: 'error'; readonly message: string };

export function LoadSampleButton(): ReactElement {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SeedResult>({ kind: 'idle' });

  async function seed(): Promise<void> {
    setPending(true);
    setResult({ kind: 'idle' });
    try {
      const response = await fetch('/api/demo/seed', { method: 'POST' });
      const body = (await response.json().catch(() => ({}))) as {
        run_id?: unknown;
        error?: unknown;
      };
      if (response.status === 201 && typeof body.run_id === 'string') {
        setResult({ kind: 'seeded', runId: body.run_id });
      } else {
        setResult({
          kind: 'error',
          message:
            typeof body.error === 'string'
              ? body.error
              : `Seeding failed (status ${response.status}).`,
        });
      }
    } catch {
      setResult({ kind: 'error', message: 'Could not reach the server.' });
    } finally {
      setPending(false);
    }
  }

  return createElement(
    'section',
    { 'aria-labelledby': 'sample-release-heading', 'data-sample-release': '' },
    createElement('h2', { id: 'sample-release-heading' }, 'Try it with sample data'),
    createElement(
      'p',
      null,
      'Seeds a synthetic release — evidence, approved features, drafts awaiting Gate #2 ' +
        '(including one blocked by an unsupported claim), an approved changelog with ' +
        'engagement, and learning-trend history. No GitHub token needed.',
    ),
    createElement(
      'button',
      { type: 'button', disabled: pending, onClick: () => void seed() },
      pending ? 'Seeding…' : 'Load sample release',
    ),
    createElement(
      'div',
      { role: 'status', 'aria-live': 'polite' },
      result.kind === 'seeded'
        ? createElement(
            'p',
            null,
            'Sample release seeded. ',
            createElement(
              'a',
              { href: `/releases/${result.runId}/artifacts/review` },
              'Open its Gate #2 review',
            ),
            '.',
          )
        : result.kind === 'error'
          ? createElement('p', null, result.message)
          : null,
    ),
  );
}
