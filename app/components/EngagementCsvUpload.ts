// T4 (spec 021) — the engagement CSV upload panel on the run's cost/outcomes view: the
// human entry point for aggregate engagement numbers (views/clicks/conversions per
// artifact), POSTing the file to /api/releases/{id}/engagement where it is parsed and
// validated SERVER-side (the boundary owns correctness; this panel owns usability).
//
// P6 (WCAG 2.2 AA): a real <form> with a labelled file input + describing hint, real
// <button>s, a single polite live-region for success/row-level errors, and controls
// disabled while the request is in flight. The template download is a real button building
// a Blob client-side — one prefilled line per (artifact × metric), so a reviewer only
// fills in numbers and dates. GDPR rails: the template and the accepted schema are
// aggregate-only; no user-level field exists end to end.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components. "use client": interactive
// leaf (ux-react) — it owns the form state and posts FormData; no secret ever reaches here.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import { clientFetch } from '../lib/clientFetch.ts';
import { buildCsvTemplate } from '../lib/engagementIngest.ts';

/** The (id, type) pairs the template prefills — passed down by the server component so no
 *  client-side fetch (and nothing beyond ids + type labels) is needed. */
export interface EngagementArtifactRef {
  readonly id: string;
  readonly artifact_type: string;
}

export interface EngagementCsvUploadProps {
  readonly releaseRunId: string;
  readonly artifacts: readonly EngagementArtifactRef[];
}

type Result =
  | { readonly kind: 'idle' }
  | { readonly kind: 'accepted'; readonly count: number }
  | { readonly kind: 'error'; readonly messages: readonly string[] };

interface IngestResponse {
  readonly accepted?: unknown;
  readonly error?: unknown;
  readonly details?: unknown;
}

/** Best-effort parse of the JSON body without throwing on a non-JSON response. */
async function readJson(response: Response): Promise<IngestResponse> {
  try {
    return (await response.json()) as IngestResponse;
  } catch {
    return {};
  }
}

/** Today as the YYYY-MM-DD the template's as_of column prefills. */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function EngagementCsvUpload({
  releaseRunId,
  artifacts,
}: EngagementCsvUploadProps): ReactElement {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result>({ kind: 'idle' });

  function downloadTemplate(): void {
    // Built on demand (today's date) and offered as a plain file download; no navigation.
    const blob = new Blob([buildCsvTemplate(artifacts, todayIsoDate())], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `engagement-${releaseRunId.replaceAll('-', '').slice(0, 8)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function submit(form: HTMLFormElement): Promise<void> {
    const input = form.elements.namedItem('engagement-csv');
    const file = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (file === undefined) {
      setResult({ kind: 'error', messages: ['Choose a CSV file to upload.'] });
      return;
    }

    setPending(true);
    setResult({ kind: 'idle' });
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await clientFetch(`/api/releases/${releaseRunId}/engagement`, {
        method: 'POST',
        body,
      });
      const parsed = await readJson(response);
      if (response.ok && typeof parsed.accepted === 'number') {
        setResult({ kind: 'accepted', count: parsed.accepted });
        form.reset();
      } else if (Array.isArray(parsed.details)) {
        setResult({ kind: 'error', messages: parsed.details.map((d) => String(d)) });
      } else {
        setResult({
          kind: 'error',
          messages: [
            typeof parsed.error === 'string'
              ? parsed.error
              : `The upload was not accepted (status ${response.status}).`,
          ],
        });
      }
    } catch {
      setResult({
        kind: 'error',
        messages: ['Could not reach the server. Check your connection and try again.'],
      });
    } finally {
      setPending(false);
    }
  }

  function feedback(): ReactElement | null {
    if (result.kind === 'accepted') {
      return createElement(
        'p',
        null,
        `Accepted ${result.count} row${result.count === 1 ? '' : 's'}. ` +
          'The cost & outcomes table below reflects the latest reported numbers.',
      );
    }
    if (result.kind === 'error') {
      return createElement(
        'div',
        null,
        createElement('p', null, 'The upload was not accepted:'),
        createElement(
          'ul',
          null,
          ...result.messages.map((m, i) => createElement('li', { key: `${i}-${m}` }, m)),
        ),
      );
    }
    return null;
  }

  return createElement(
    'section',
    { 'aria-labelledby': 'engagement-upload-heading' },
    createElement('h2', { id: 'engagement-upload-heading' }, 'Report engagement (CSV)'),
    createElement(
      'p',
      null,
      'Upload aggregate counts only — views, clicks, and conversions per artifact. ',
      'No user-level data is accepted.',
    ),
    createElement(
      'button',
      { type: 'button', onClick: downloadTemplate, disabled: pending },
      'Download CSV template',
    ),
    createElement(
      'form',
      {
        'aria-busy': pending,
        onSubmit: (e: { preventDefault: () => void; currentTarget: HTMLFormElement }) => {
          e.preventDefault();
          void submit(e.currentTarget);
        },
      },
      createElement(
        'p',
        null,
        createElement('label', { htmlFor: 'engagement-csv' }, 'Engagement CSV file'),
        createElement('input', {
          id: 'engagement-csv',
          name: 'engagement-csv',
          type: 'file',
          accept: '.csv,text/csv',
          required: true,
          disabled: pending,
          'aria-describedby': 'engagement-csv-hint',
        }),
        createElement(
          'span',
          { id: 'engagement-csv-hint' },
          'Columns: artifact_id, metric (views/clicks/conversions), value, as_of ' +
            '(YYYY-MM-DD). Re-uploading the same rows safely overwrites them.',
        ),
      ),
      createElement(
        'button',
        { type: 'submit', disabled: pending },
        pending ? 'Uploading…' : 'Upload engagement CSV',
      ),
    ),
    // One polite live region announces success or row-level errors to screen readers.
    createElement('div', { role: 'status', 'aria-live': 'polite' }, feedback()),
  );
}
