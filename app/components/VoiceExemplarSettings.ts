// /settings — company voice exemplar editor (the embedded voice corpus). Paste real published
// content (a past blog, post, email); the worker embeds it later (Bedrock) and generation
// retrieves the closest exemplars per release. Client island: POSTs to /api/settings/voice.
// P6 (WCAG 2.2 AA): labelled fields, headed list items, polite status. createElement for the
// dependency-free a11y harness.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { IcpSegment, VoiceExemplar } from '@/app/lib/brandBrain.ts';
// Relative (not '@/') for the VALUE import so the dependency-free `node --test` a11y harness
// resolves it at runtime; the bundler alias is only safe for erased type imports.
import { ALL_ARTIFACT_TYPES, typeLabel } from '../lib/artifactTypes.ts';
import { labeledInput, labeledTextarea, labeledSelect } from './settingsControls.ts';

export interface VoiceExemplarSettingsProps {
  readonly exemplars: readonly VoiceExemplar[];
  readonly segments: readonly IcpSegment[];
}

function excerpt(text: string): string {
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

function exemplarList(
  exemplars: readonly VoiceExemplar[],
  onDelete: (id: string) => void,
): ReactElement {
  if (exemplars.length === 0) {
    return createElement(
      'p',
      null,
      'No voice exemplars yet — paste a few pieces of your real published content below so ' +
        'generation can match your voice.',
    );
  }
  return createElement(
    'ul',
    { 'data-voice-list': true },
    ...exemplars.map((e) =>
      createElement(
        'li',
        { key: e.id, 'data-voice-id': e.id },
        createElement('h3', null, e.title === '' ? '(untitled exemplar)' : e.title),
        createElement(
          'p',
          null,
          `Channel: ${e.channel === 'any' ? 'any' : typeLabel(e.channel)}`,
          e.icp_segment_id ? ` · ICP: ${e.icp_segment_id}` : '',
        ),
        // Honest signal of whether the Bedrock embedding has run yet (worker-side).
        createElement(
          'p',
          { 'data-embedded': e.embedded ? 'yes' : 'no', 'data-status-category': e.embedded ? 'done' : 'awaiting' },
          e.embedded ? 'embedded' : 'pending embedding',
        ),
        createElement('p', null, excerpt(e.body_text)),
        createElement('button', { type: 'button', onClick: () => onDelete(e.id) }, 'Delete exemplar'),
      ),
    ),
  );
}

export function VoiceExemplarSettings({
  exemplars,
  segments,
}: VoiceExemplarSettingsProps): ReactElement {
  const [title, setTitle] = useState('');
  const [channel, setChannel] = useState('any');
  const [body, setBody] = useState('');
  const [source, setSource] = useState('');
  const [icp, setIcp] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  const channelOptions = [
    { value: 'any', label: 'Any channel' },
    ...ALL_ARTIFACT_TYPES.map((t) => ({ value: t, label: typeLabel(t) })),
  ];
  const icpOptions = [
    { value: '', label: 'Not segment-specific' },
    ...segments.map((s) => ({ value: s.id, label: s.name })),
  ];

  async function create(): Promise<void> {
    if (body.trim() === '') {
      setMessage('Paste the exemplar content.');
      return;
    }
    setPending(true);
    setMessage('Saving exemplar…');
    try {
      const response = await fetch('/api/settings/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body_text: body,
          channel,
          source: source === '' ? undefined : source,
          icp_segment_id: icp === '' ? undefined : icp,
        }),
      });
      if (response.ok) window.location.reload();
      else setMessage(`Could not save the exemplar (status ${response.status}).`);
    } catch {
      setMessage('Could not save the exemplar — the request did not complete.');
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string): Promise<void> {
    setMessage('Deleting…');
    try {
      const response = await fetch(`/api/settings/voice/${id}`, { method: 'DELETE' });
      if (response.ok) window.location.reload();
      else setMessage(`Could not delete (status ${response.status}).`);
    } catch {
      setMessage('Could not delete — the request did not complete.');
    }
  }

  return createElement(
    'div',
    { 'data-voice-settings': true },
    exemplarList(exemplars, (id) => void remove(id)),
    createElement('h3', null, 'Add a voice exemplar'),
    labeledInput('voice-title', 'Title', title, setTitle, { placeholder: 'e.g. v1.10 launch blog' }),
    labeledSelect('voice-channel', 'Channel', channel, setChannel, channelOptions),
    labeledSelect('voice-icp', 'ICP segment (optional)', icp, setIcp, icpOptions),
    labeledInput('voice-source', 'Source (optional)', source, setSource, {
      placeholder: 'e.g. blog.acme.com/launch',
    }),
    labeledTextarea('voice-body', 'Content', body, setBody, { rows: 8, required: true }),
    createElement('button', { type: 'button', disabled: pending, onClick: () => void create() }, 'Save exemplar'),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, message),
  );
}
