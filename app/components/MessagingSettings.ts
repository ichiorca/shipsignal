// /settings — messaging claim editor (approved, evidence-backed positioning per ICP). Generation
// injects the approved claims for the target ICP; the claim/check node can defend them via
// evidence_url. Client island: POSTs to /api/settings/messaging. P6 (WCAG 2.2 AA): labelled
// fields, headed list items, polite status. createElement for the dependency-free a11y harness.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { IcpSegment, MessagingClaim } from '@/app/lib/brandBrain.ts';
import { clientFetch } from '../lib/clientFetch.ts';
import { labeledInput, labeledTextarea, labeledSelect, splitLines } from './settingsControls.ts';

export interface MessagingSettingsProps {
  readonly claims: readonly MessagingClaim[];
  readonly segments: readonly IcpSegment[];
}

function claimList(claims: readonly MessagingClaim[], onDelete: (id: string) => void): ReactElement {
  if (claims.length === 0) {
    return createElement(
      'p',
      null,
      'No messaging claims yet — add the approved value props / positioning generation may use.',
    );
  }
  return createElement(
    'ul',
    { 'data-messaging-list': true },
    ...claims.map((c) =>
      createElement(
        'li',
        { key: c.id, 'data-claim-id': c.id },
        createElement('h3', null, c.claim_text),
        createElement(
          'p',
          { 'data-status': c.status, 'data-status-category': c.status === 'approved' ? 'done' : c.status === 'archived' ? 'failed' : 'awaiting' },
          `${c.claim_type} · ${c.status}`,
        ),
        c.applies_to_icp.length > 0
          ? createElement('p', null, `ICP: ${c.applies_to_icp.join(', ')}`)
          : createElement('p', null, 'ICP: all'),
        c.evidence_url
          ? createElement('p', null, createElement('a', { href: c.evidence_url }, c.evidence_url))
          : null,
        createElement('button', { type: 'button', onClick: () => onDelete(c.id) }, 'Delete claim'),
      ),
    ),
  );
}

export function MessagingSettings({ claims, segments }: MessagingSettingsProps): ReactElement {
  const [text, setText] = useState('');
  const [type, setType] = useState('positioning');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [appliesTo, setAppliesTo] = useState('');
  const [status, setStatus] = useState('approved');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  const segmentHint =
    segments.length > 0
      ? `Available segment ids: ${segments.map((s) => s.id).join(', ')}`
      : 'No ICP segments defined yet — leave blank to apply to all.';

  async function create(): Promise<void> {
    if (text.trim() === '') {
      setMessage('Enter the claim text.');
      return;
    }
    setPending(true);
    setMessage('Saving claim…');
    try {
      const response = await clientFetch('/api/settings/messaging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claim_text: text,
          claim_type: type,
          evidence_url: evidenceUrl === '' ? undefined : evidenceUrl,
          applies_to_icp: splitLines(appliesTo),
          status,
        }),
      });
      if (response.ok) window.location.reload();
      else setMessage(`Could not save the claim (status ${response.status}).`);
    } catch {
      setMessage('Could not save the claim — the request did not complete.');
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setMessage('Deleting…');
    try {
      const response = await clientFetch(`/api/settings/messaging/${id}`, { method: 'DELETE' });
      if (response.ok) window.location.reload();
      else setMessage(`Could not delete (status ${response.status}).`);
    } catch {
      setMessage('Could not delete — the request did not complete.');
    }
  }

  return createElement(
    'div',
    { 'data-messaging-settings': true },
    claimList(claims, (id) => void remove(id)),
    createElement('h3', null, 'Add a messaging claim'),
    labeledTextarea('claim-text', 'Claim', text, setText, { required: true, rows: 2 }),
    labeledSelect('claim-type', 'Type', type, setType, [
      { value: 'positioning', label: 'Positioning' },
      { value: 'feature_proof', label: 'Feature proof' },
      { value: 'differentiator', label: 'Differentiator' },
    ]),
    labeledInput('claim-evidence', 'Evidence URL (optional)', evidenceUrl, setEvidenceUrl, {
      placeholder: 'https://… or internal://…',
    }),
    labeledTextarea('claim-icp', 'Applies to ICP ids (one per line; blank = all)', appliesTo, setAppliesTo, {
      placeholder: segmentHint,
    }),
    labeledSelect('claim-status', 'Status', status, setStatus, [
      { value: 'approved', label: 'Approved' },
      { value: 'draft', label: 'Draft' },
      { value: 'archived', label: 'Archived' },
    ]),
    createElement('button', { type: 'button', disabled: pending, onClick: () => void create() }, 'Save claim'),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, message),
  );
}
