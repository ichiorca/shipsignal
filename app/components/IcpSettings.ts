// /settings — ICP segment editor (the canonical "who we market to"). Lists existing segments and
// adds new ones. Client island: POSTs to /api/settings/icp and reloads to reflect the server list.
// P6 (WCAG 2.2 AA): every field is labelled, the list items are headed sections, status is a
// polite live region. Authored with React.createElement for the dependency-free a11y harness.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { IcpSegment } from '@/app/lib/brandBrain.ts';
import { clientFetch } from '../lib/clientFetch.ts';
import { labeledInput, labeledTextarea, labeledSelect, splitLines } from './settingsControls.ts';

export interface IcpSettingsProps {
  readonly segments: readonly IcpSegment[];
}

function segmentList(segments: readonly IcpSegment[], onDelete: (id: string) => void): ReactElement {
  if (segments.length === 0) {
    return createElement('p', null, 'No ICP segments yet — define who you market to below.');
  }
  return createElement(
    'ul',
    { 'data-icp-list': true },
    ...segments.map((s) =>
      createElement(
        'li',
        { key: s.id, 'data-icp-id': s.id },
        createElement('h3', null, s.name),
        createElement('p', { 'data-status': s.status, 'data-status-category': s.status === 'active' ? 'done' : 'failed' }, s.status),
        s.description ? createElement('p', null, s.description) : null,
        s.pain_points.length > 0
          ? createElement('p', null, `Pains: ${s.pain_points.join('; ')}`)
          : null,
        s.approved_angles.length > 0
          ? createElement('p', null, `Angles: ${s.approved_angles.join('; ')}`)
          : null,
        createElement(
          'button',
          { type: 'button', onClick: () => onDelete(s.id) },
          `Delete ${s.name}`,
        ),
      ),
    ),
  );
}

export function IcpSettings({ segments }: IcpSettingsProps): ReactElement {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [buyerRoles, setBuyerRoles] = useState('');
  const [painPoints, setPainPoints] = useState('');
  const [objections, setObjections] = useState('');
  const [angles, setAngles] = useState('');
  const [status, setStatus] = useState('active');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function create(): Promise<void> {
    if (name.trim() === '') {
      setMessage('Enter a segment name.');
      return;
    }
    setPending(true);
    setMessage('Saving segment…');
    try {
      const response = await clientFetch('/api/settings/icp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          buyer_roles: splitLines(buyerRoles),
          pain_points: splitLines(painPoints),
          objections: splitLines(objections),
          approved_angles: splitLines(angles),
          status,
        }),
      });
      if (response.ok) {
        window.location.reload();
      } else {
        setMessage(`Could not save the segment (status ${response.status}).`);
      }
    } catch {
      setMessage('Could not save the segment — the request did not complete.');
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setMessage('Deleting…');
    try {
      const response = await clientFetch(`/api/settings/icp/${id}`, { method: 'DELETE' });
      if (response.ok) window.location.reload();
      else setMessage(`Could not delete (status ${response.status}).`);
    } catch {
      setMessage('Could not delete — the request did not complete.');
    }
  }

  return createElement(
    'div',
    { 'data-icp-settings': true },
    segmentList(segments, (id) => void remove(id)),
    createElement('h3', null, 'Add an ICP segment'),
    labeledInput('icp-name', 'Segment name', name, setName, { required: true, placeholder: 'e.g. DTC merchant' }),
    labeledTextarea('icp-description', 'Description', description, setDescription),
    labeledTextarea('icp-buyer-roles', 'Buyer roles (one per line)', buyerRoles, setBuyerRoles),
    labeledTextarea('icp-pains', 'Pain points (one per line)', painPoints, setPainPoints),
    labeledTextarea('icp-objections', 'Objections (one per line)', objections, setObjections),
    labeledTextarea('icp-angles', 'Approved angles (one per line)', angles, setAngles),
    labeledSelect('icp-status', 'Status', status, setStatus, [
      { value: 'active', label: 'Active' },
      { value: 'archived', label: 'Archived' },
    ]),
    createElement('button', { type: 'button', disabled: pending, onClick: () => void create() }, 'Save segment'),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, message),
  );
}
