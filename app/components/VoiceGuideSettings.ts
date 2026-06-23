// Brand Voice — structured voice-guide editor (migration 0033). Authors the company's voice RULES
// (tone, reading level, do/don't rules, preferred/avoided vocabulary) that ground every draft,
// alongside the example posts in VoiceExemplarSettings. Client island: PUTs the whole guide to
// /api/settings/voice-guide. P6 (WCAG 2.2 AA): labelled fields, one status region, polite live
// updates. createElement (not JSX) so it renders under the dependency-free `node --test` a11y
// harness; VALUE imports are relative for that harness, type imports use the '@/' alias (erased).

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { VoiceGuide } from '@/app/lib/brandBrain.ts';
import { clientFetch } from '../lib/clientFetch.ts';
import { labeledInput, labeledTextarea, splitLines, joinLines } from './settingsControls.ts';

export interface VoiceGuideSettingsProps {
  readonly guide: VoiceGuide;
}

export function VoiceGuideSettings({ guide }: VoiceGuideSettingsProps): ReactElement {
  const [tone, setTone] = useState(guide.tone);
  const [readingLevel, setReadingLevel] = useState(guide.reading_level);
  const [doRules, setDoRules] = useState(joinLines(guide.do_rules));
  const [dontRules, setDontRules] = useState(joinLines(guide.dont_rules));
  const [preferTerms, setPreferTerms] = useState(joinLines(guide.prefer_terms));
  const [avoidTerms, setAvoidTerms] = useState(joinLines(guide.avoid_terms));
  const [notes, setNotes] = useState(guide.notes);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function save(): Promise<void> {
    setPending(true);
    setMessage('Saving voice guide…');
    try {
      const response = await clientFetch('/api/settings/voice-guide', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tone,
          reading_level: readingLevel,
          do_rules: splitLines(doRules),
          dont_rules: splitLines(dontRules),
          prefer_terms: splitLines(preferTerms),
          avoid_terms: splitLines(avoidTerms),
          notes,
        }),
      });
      if (response.ok) setMessage('Voice guide saved.');
      else setMessage(`Could not save the voice guide (status ${response.status}).`);
    } catch {
      setMessage('Could not save the voice guide — the request did not complete.');
    } finally {
      setPending(false);
    }
  }

  return createElement(
    'div',
    { 'data-voice-guide-settings': true },
    labeledInput('vg-tone', 'Tone', tone, setTone, {
      placeholder: 'e.g. confident, plain, specific — no hype',
    }),
    labeledInput('vg-reading-level', 'Reading level', readingLevel, setReadingLevel, {
      placeholder: 'e.g. grade 8 / accessible to non-experts',
    }),
    labeledTextarea('vg-do', 'Do (one rule per line)', doRules, setDoRules, {
      rows: 4,
      placeholder: 'Lead with the user value\nUse concrete numbers and examples',
    }),
    labeledTextarea('vg-dont', "Don't (one rule per line)", dontRules, setDontRules, {
      rows: 4,
      placeholder: 'No superlatives or hype\nNo unproven claims',
    }),
    labeledTextarea('vg-prefer', 'Prefer these terms (one per line)', preferTerms, setPreferTerms, {
      rows: 3,
      placeholder: 'ship\ncustomer',
    }),
    labeledTextarea('vg-avoid', 'Avoid these terms (one per line)', avoidTerms, setAvoidTerms, {
      rows: 3,
      placeholder: 'leverage\nsynergy',
    }),
    labeledTextarea('vg-notes', 'Other notes (optional)', notes, setNotes, { rows: 3 }),
    createElement(
      'button',
      { type: 'button', disabled: pending, onClick: () => void save() },
      'Save voice guide',
    ),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, message),
  );
}
