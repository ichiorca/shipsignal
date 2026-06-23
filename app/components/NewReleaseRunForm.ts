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
import { clientFetch } from '../lib/clientFetch.ts';
import {
  ALL_ARTIFACT_TYPES,
  typeLabel,
  type ArtifactType,
} from '../lib/artifactTypes.ts';
import type { ProjectView } from '../lib/projects.ts';

export interface NewReleaseRunFormProps {
  /** Active saved projects to offer as a pre-fill picker; empty → no picker (ad-hoc only). */
  readonly projects?: readonly ProjectView[];
}

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

export function NewReleaseRunForm({ projects = [] }: NewReleaseRunFormProps = {}): ReactElement {
  const [repo, setRepo] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [headRef, setHeadRef] = useState('');
  // Optional saved-project association: pre-fills repo/refs and links the run so the worker uses
  // the project's GitHub credential. '' = ad-hoc (type the repo manually).
  const [projectId, setProjectId] = useState('');
  // T2 (spec 022) — the per-run artifact-type selection; all six checked by default so the
  // pre-selection behaviour (generate everything) stays the path of least resistance.
  const [selectedTypes, setSelectedTypes] = useState<readonly ArtifactType[]>(
    ALL_ARTIFACT_TYPES,
  );
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result>({ kind: 'idle' });

  function selectProject(id: string): void {
    setProjectId(id);
    const project = projects.find((p) => p.id === id);
    if (project) {
      if (project.repos[0]) setRepo(project.repos[0]);
      setBaseRef(project.default_base_ref);
      setHeadRef(project.default_head_ref);
    }
  }

  function toggleType(type: ArtifactType): void {
    setSelectedTypes((current) =>
      current.includes(type)
        ? current.filter((t) => t !== type)
        : // Keep canonical §8.1 order regardless of click order.
          ALL_ARTIFACT_TYPES.filter((t) => current.includes(t) || t === type),
    );
  }

  async function submit(): Promise<void> {
    // Instant client-side check for the obvious "empty field" case; the server's zod
    // schema remains the authority on format (owner/repo, valid git ref).
    const missing: string[] = [];
    if (repo.trim() === '') missing.push('Repository is required.');
    if (baseRef.trim() === '') missing.push('Base ref is required.');
    if (headRef.trim() === '') missing.push('Head ref is required.');
    if (selectedTypes.length === 0) {
      missing.push('Select at least one artifact type.');
    }
    if (missing.length > 0) {
      setResult({ kind: 'error', messages: missing });
      return;
    }

    setPending(true);
    setResult({ kind: 'idle' });
    try {
      const response = await clientFetch('/api/releases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repo: repo.trim(),
          base_ref: baseRef.trim(),
          head_ref: headRef.trim(),
          artifact_types: selectedTypes,
          ...(projectId ? { project_id: projectId } : {}),
        }),
      });
      const body = await readJson(response);
      const runId = typeof body.run?.id === 'string' ? body.run.id : null;

      if (response.status === 201 && runId !== null) {
        setResult({ kind: 'created', runId, dispatched: true });
        setRepo('');
        setBaseRef('');
        setHeadRef('');
        setProjectId('');
        setSelectedTypes(ALL_ARTIFACT_TYPES);
      } else if (response.status === 502 && runId !== null) {
        // Soft success: the run row exists; only the Actions dispatch failed.
        setResult({ kind: 'created', runId, dispatched: false });
        setRepo('');
        setBaseRef('');
        setHeadRef('');
        setProjectId('');
        setSelectedTypes(ALL_ARTIFACT_TYPES);
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

  // T2 (spec 022) — the artifact-type checkbox group (WCAG 2.2 AA): a <fieldset> with a
  // <legend> names the group; each native checkbox is labelled; the demo_script row carries
  // a describing hint surfacing the cross-feature dependency (demo media needs the script).
  function artifactTypeCheckbox(type: ArtifactType): ReactElement {
    const id = `artifact-type-${type}`;
    const isDemoScript = type === 'demo_script';
    const hintId = isDemoScript ? `${id}-hint` : undefined;
    return createElement(
      'p',
      { key: type },
      createElement('input', {
        id,
        name: 'artifact_types',
        type: 'checkbox',
        value: type,
        checked: selectedTypes.includes(type),
        disabled: pending,
        'aria-describedby': hintId,
        onChange: () => toggleType(type),
      }),
      createElement('label', { htmlFor: id }, typeLabel(type)),
      isDemoScript
        ? createElement(
            'span',
            { id: hintId },
            'Needed for demo media — deselecting it disables demo generation for this run.',
          )
        : null,
    );
  }

  function artifactTypeGroup(): ReactElement {
    return createElement(
      'fieldset',
      null,
      createElement('legend', null, 'Artifact types'),
      createElement(
        'p',
        { id: 'artifact-types-hint' },
        'Which artifacts this run generates. Deselected types cost no model spend and ' +
          'never appear at review.',
      ),
      ...ALL_ARTIFACT_TYPES.map((type) => artifactTypeCheckbox(type)),
    );
  }

  // Optional project picker (only when saved projects exist). Selecting one pre-fills the repo/refs
  // below and links the run so the worker resolves the project's GitHub credential. WCAG 2.2 AA:
  // label[htmlFor] ↔ select[id] + a describing hint.
  function projectPicker(): ReactElement | null {
    if (projects.length === 0) return null;
    return createElement(
      'p',
      null,
      createElement('label', { htmlFor: 'project' }, 'Project (optional)'),
      createElement(
        'select',
        {
          id: 'project',
          name: 'project',
          value: projectId,
          disabled: pending,
          'aria-describedby': 'project-hint',
          onChange: (e: { target: { value: string } }) => selectProject(e.target.value),
        },
        createElement('option', { value: '' }, '— Ad-hoc (enter repo manually) —'),
        ...projects.map((p) => createElement('option', { key: p.id, value: p.id }, p.name)),
      ),
      createElement(
        'span',
        { id: 'project-hint' },
        'Pick a saved project to pre-fill its repo and refs and use its GitHub credential.',
      ),
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
      projectPicker(),
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
      artifactTypeGroup(),
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
