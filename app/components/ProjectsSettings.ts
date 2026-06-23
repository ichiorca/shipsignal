// /projects — saved repo configurations (each = repos + default refs + a GitHub credential
// REFERENCE). Client island: POSTs to /api/projects and reloads. The credential is shown only as a
// status ("secret configured" / "ambient token") — the component receives ProjectView, which never
// carries the token or its ARN (constitution §5). Authored with React.createElement for the
// dependency-free a11y harness. P6 (WCAG 2.2 AA): labelled fields, headed list items, polite status.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { ProjectView } from '@/app/lib/projects.ts';
import { clientFetch } from '../lib/clientFetch.ts';
import { labeledInput, labeledTextarea, labeledSelect, splitLines } from './settingsControls.ts';

export interface ProjectsSettingsProps {
  readonly projects: readonly ProjectView[];
}

function projectList(
  projects: readonly ProjectView[],
  onEdit: (project: ProjectView) => void,
  onDelete: (id: string) => void,
): ReactElement {
  if (projects.length === 0) {
    return createElement(
      'p',
      { 'data-empty': 'projects' },
      'No projects yet — pre-configure a repo and its GitHub credential below.',
    );
  }
  return createElement(
    'ul',
    { 'data-projects-list': true },
    ...projects.map((p) =>
      createElement(
        'li',
        { key: p.id, 'data-project-id': p.id },
        createElement('h3', null, p.name),
        createElement(
          'p',
          {
            'data-status': p.status,
            'data-status-category': p.status === 'active' ? 'done' : 'failed',
          },
          p.status,
        ),
        createElement(
          'p',
          null,
          p.repos.length > 0 ? `Repos: ${p.repos.join(', ')}` : 'No repos configured',
        ),
        p.default_base_ref || p.default_head_ref
          ? createElement(
              'p',
              null,
              `Default range: ${p.default_base_ref || '—'} → ${p.default_head_ref || '—'}`,
            )
          : null,
        createElement(
          'p',
          { 'data-secret-status': p.has_secret ? 'configured' : 'ambient' },
          p.has_secret
            ? '✓ GitHub secret configured (AWS Secrets Manager)'
            : 'Using the ambient GITHUB_TOKEN (no per-project secret)',
        ),
        createElement(
          'button',
          { type: 'button', onClick: () => onEdit(p) },
          `Edit ${p.name}`,
        ),
        createElement(
          'button',
          { type: 'button', onClick: () => onDelete(p.id) },
          `Delete ${p.name}`,
        ),
      ),
    ),
  );
}

export function ProjectsSettings({ projects }: ProjectsSettingsProps): ReactElement {
  const [name, setName] = useState('');
  const [repos, setRepos] = useState('');
  const [baseRef, setBaseRef] = useState('');
  const [headRef, setHeadRef] = useState('');
  const [secretId, setSecretId] = useState('');
  const [status, setStatus] = useState('active');
  // null = creating a new project; a project id = editing that project (PATCH instead of POST).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  function startEdit(project: ProjectView): void {
    setEditingId(project.id);
    setName(project.name);
    setRepos(project.repos.join('\n'));
    setBaseRef(project.default_base_ref);
    setHeadRef(project.default_head_ref);
    // The secret reference is never sent to the client (§5: ProjectView has only has_secret), so the
    // field starts blank and a blank value keeps the current reference (the PATCH COALESCEs it).
    setSecretId('');
    setStatus(project.status);
    setMessage(`Editing "${project.name}" — change fields and Save, or Cancel.`);
  }

  function resetForm(): void {
    setEditingId(null);
    setName('');
    setRepos('');
    setBaseRef('');
    setHeadRef('');
    setSecretId('');
    setStatus('active');
  }

  function cancelEdit(): void {
    resetForm();
    setMessage('');
  }

  async function save(): Promise<void> {
    if (name.trim() === '') {
      setMessage('Enter a project name.');
      return;
    }
    setPending(true);
    setMessage(editingId ? 'Updating project…' : 'Saving project…');
    const payload = {
      name,
      repos: splitLines(repos),
      default_base_ref: baseRef.trim(),
      default_head_ref: headRef.trim(),
      github_secret_id: secretId.trim() === '' ? undefined : secretId.trim(),
      status,
    };
    try {
      const response = editingId
        ? await clientFetch(`/api/projects/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await clientFetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
      if (response.ok) {
        window.location.reload();
      } else {
        setMessage(`Could not save the project (status ${response.status}).`);
      }
    } catch {
      setMessage('Could not save the project — the request did not complete.');
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setMessage('Deleting…');
    try {
      const response = await clientFetch(`/api/projects/${id}`, { method: 'DELETE' });
      if (response.ok) window.location.reload();
      else setMessage(`Could not delete (status ${response.status}).`);
    } catch {
      setMessage('Could not delete — the request did not complete.');
    }
  }

  const secretLabel = editingId
    ? 'GitHub secret reference (AWS Secrets Manager name/ARN — leave blank to keep current)'
    : 'GitHub secret reference (AWS Secrets Manager name/ARN — not the token)';

  return createElement(
    'div',
    { 'data-projects-settings': true },
    projectList(projects, startEdit, (id) => void remove(id)),
    createElement('h3', null, editingId ? 'Edit project' : 'Add a project'),
    labeledInput('project-name', 'Project name', name, setName, {
      required: true,
      placeholder: 'e.g. Acme Launchpad',
    }),
    labeledTextarea('project-repos', 'Repositories (one owner/repo per line)', repos, setRepos),
    labeledInput('project-base-ref', 'Default base ref', baseRef, setBaseRef, {
      placeholder: 'e.g. main',
    }),
    labeledInput('project-head-ref', 'Default head ref', headRef, setHeadRef, {
      placeholder: 'e.g. release',
    }),
    labeledInput('project-secret-id', secretLabel, secretId, setSecretId, {
      placeholder: 'e.g. shipsignal/github/acme',
    }),
    labeledSelect('project-status', 'Status', status, setStatus, [
      { value: 'active', label: 'Active' },
      { value: 'archived', label: 'Archived' },
    ]),
    createElement(
      'button',
      { type: 'button', disabled: pending, onClick: () => void save() },
      editingId ? 'Save changes' : 'Save project',
    ),
    editingId
      ? createElement(
          'button',
          { type: 'button', disabled: pending, onClick: () => cancelEdit() },
          'Cancel edit',
        )
      : null,
    createElement('p', { role: 'status', 'aria-live': 'polite' }, message),
  );
}
