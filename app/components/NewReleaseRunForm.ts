// Start-a-run form: the human entry point for a manual compare-range release run
// (POST /api/releases). The repo/base/head path was previously API-only; this is the
// missing UI. P6 (WCAG 2.2 AA): a real <form> with associated <label>s + describing
// hints, a single polite live-region for feedback, real <button>, and inputs/submit
// disabled while the request is in flight.
//
// Soft success on dispatch failure: the API returns 502 with the run STILL created when
// the GitHub workflow_dispatch fails (common locally — no workflow/token). We surface
// that as a success ("run created; dispatch skipped") with a link to the run, not an
// error, so a run can be seeded locally without a working Actions setup.
//
// Authored with React.createElement (not JSX) so it renders under the dependency-free
// `node --test` a11y harness, mirroring the other components. "use client": interactive
// leaf (ux-react) — it owns the form state and posts JSON; no secret ever reaches here.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';

type Result =
  | { readonly kind: 'idle' }
  | { readonly kind: 'created'; readonly runId: string; readonly dispatched: boolean }
  | { readonly kind: 'error'; readonly messages: readonly string[] };

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

interface CreatedResponse {
  readonly run?: { readonly id?: unknown };
  readonly details?: unknown;
  readonly error?: unknown;
}

/** Best-effort parse of the JSON body without throwing on a non-JSON response. */
async function readJson(response: Response): Promise<CreatedResponse> {
  try {
    return (await response.json()) as CreatedResponse;
  } catch {
    return {};
  }
}

export function NewReleaseRunForm(): ReactElement {
  const [repo, setRepo] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [headRef, setHeadRef] = useState('');
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result>({ kind: 'idle' });

  async function submit(): Promise<void> {
    // Instant client-side check for the obvious "empty field" case; the server's zod
    // schema remains the authority on format (owner/repo, valid git ref).
    const missing: string[] = [];
    if (repo.trim() === '') missing.push('Repository is required.');
    if (baseRef.trim() === '') missing.push('Base ref is required.');
    if (headRef.trim() === '') missing.push('Head ref is required.');
    if (missing.length > 0) {
      setResult({ kind: 'error', messages: missing });
      return;
    }

    setPending(true);
    setResult({ kind: 'idle' });
    try {
      const response = await fetch('/api/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: repo.trim(),
          base_ref: baseRef.trim(),
          head_ref: headRef.trim(),
        }),
      });
      const body = await readJson(response);
      const runId = typeof body.run?.id === 'string' ? body.run.id : null;

      if (response.status === 201 && runId !== null) {
        setResult({ kind: 'created', runId, dispatched: true });
        setRepo('');
        setBaseRef('');
        setHeadRef('');
      } else if (response.status === 502 && runId !== null) {
        // Soft success: the run row exists; only the Actions dispatch failed.
        setResult({ kind: 'created', runId, dispatched: false });
        setRepo('');
        setBaseRef('');
        setHeadRef('');
      } else if (response.status === 400 && Array.isArray(body.details)) {
        setResult({
          kind: 'error',
          messages: body.details.map((d) => String(d)),
        });
      } else {
        setResult({
          kind: 'error',
          messages: [`Could not create the run (status ${response.status}).`],
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

  function field(
    id: string,
    label: string,
    hint: string,
    value: string,
    onValue: (v: string) => void,
    placeholder: string,
  ): ReactElement {
    const hintId = `${id}-hint`;
    return createElement(
      'p',
      { key: id },
      createElement('label', { htmlFor: id }, label),
      createElement('input', {
        id,
        name: id,
        type: 'text',
        value,
        placeholder,
        required: true,
        disabled: pending,
        'aria-describedby': hintId,
        onChange: (e: { target: { value: string } }) => onValue(e.target.value),
      }),
      createElement('span', { id: hintId }, hint),
    );
  }

  function feedback(): ReactElement | null {
    if (result.kind === 'created') {
      return createElement(
        'div',
        null,
        createElement(
          'p',
          null,
          result.dispatched
            ? `Release run ${shortId(result.runId)} created and the analysis job was started.`
            : `Release run ${shortId(result.runId)} created. The analysis job was not started ` +
                '(workflow dispatch failed); you can resume it later.',
        ),
        createElement(
          'a',
          { href: `/releases/${result.runId}` },
          `Open run ${shortId(result.runId)}`,
        ),
      );
    }
    if (result.kind === 'error') {
      return createElement(
        'div',
        null,
        createElement('p', null, 'The run could not be created:'),
        createElement(
          'ul',
          null,
          ...result.messages.map((m, i) =>
            createElement('li', { key: `${i}-${m}` }, m),
          ),
        ),
      );
    }
    return null;
  }

  return createElement(
    'section',
    { 'aria-labelledby': 'new-run-heading' },
    createElement('h2', { id: 'new-run-heading' }, 'Start a release run'),
    createElement(
      'form',
      {
        'aria-busy': pending,
        onSubmit: (e: { preventDefault: () => void }) => {
          e.preventDefault();
          void submit();
        },
      },
      field(
        'repo',
        'Repository',
        'Format: owner/repo — e.g. octocat/Hello-World.',
        repo,
        setRepo,
        'owner/repo',
      ),
      field(
        'base_ref',
        'Base ref',
        'The "from" point of the compare range: a branch, tag, or commit SHA.',
        baseRef,
        setBaseRef,
        'v1.2.0',
      ),
      field(
        'head_ref',
        'Head ref',
        'The "to" point — what is new since the base: a branch, tag, or commit SHA.',
        headRef,
        setHeadRef,
        'v1.3.0',
      ),
      createElement(
        'button',
        { type: 'submit', disabled: pending },
        pending ? 'Creating…' : 'Create release run',
      ),
    ),
    // One polite live region announces success or validation errors to screen readers.
    createElement('div', { role: 'status', 'aria-live': 'polite' }, feedback()),
  );
}
