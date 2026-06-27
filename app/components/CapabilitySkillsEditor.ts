// /capabilities — operator editor for the capability→skill mapping (migration 0032). Per capability
// (artifact type) you can remove a grounding skill or add one from the skill library; each edit is
// persisted as an operator override (PUT/DELETE → /api/settings/capabilities) and the worker resolves
// it at generation time. Client island: createElement (dependency-free a11y harness); VALUE imports
// relative, type imports via '@/' alias (erased).

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { CapabilityMapping } from '@/app/lib/db/capabilitySkills.ts';
import { clientFetch } from '../lib/clientFetch.ts';
import { typeLabel } from '../lib/artifactTypes.ts';

export interface CapabilitySkillsEditorProps {
  readonly capabilities: readonly CapabilityMapping[];
  readonly availableSkills: readonly string[];
}

export function CapabilitySkillsEditor({
  capabilities,
  availableSkills,
}: CapabilitySkillsEditorProps): ReactElement {
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const [adds, setAdds] = useState<Record<string, string>>({});

  async function send(
    method: 'POST' | 'DELETE',
    artifactType: string,
    skillName: string,
  ): Promise<void> {
    setPending(`${artifactType}:${skillName}`);
    setMessage(method === 'DELETE' ? 'Removing…' : 'Adding…');
    try {
      const response = await clientFetch('/api/settings/capabilities', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artifact_type: artifactType, skill_name: skillName, required: true }),
      });
      if (response.ok) window.location.reload();
      else setMessage(`Could not save the mapping (status ${response.status}).`);
    } catch {
      setMessage('Could not save the mapping — the request did not complete.');
    } finally {
      setPending('');
    }
  }

  return createElement(
    'div',
    { 'data-capability-editor': true },
    ...capabilities.map((cap) => {
      const mapped = new Set(cap.skills.map((s) => s.skill_name));
      const addable = availableSkills.filter((s) => !mapped.has(s));
      const selected = adds[cap.artifact_type] ?? addable[0] ?? '';
      const addId = `add-${cap.artifact_type}`;
      return createElement(
        'section',
        { key: cap.artifact_type, 'data-cap': cap.artifact_type },
        createElement('h3', null, typeLabel(cap.artifact_type)),
        createElement(
          'ul',
          { 'data-cap-skills': true },
          ...cap.skills.map((s) =>
            createElement(
              'li',
              { key: s.skill_name, 'data-cap-skill': s.skill_name },
              `${s.skill_name}${s.required ? '' : ' (optional)'} — `,
              createElement(
                'span',
                { 'data-source': s.source },
                s.source === 'operator-override' ? 'override' : 'default',
              ),
              ' ',
              createElement(
                'button',
                {
                  type: 'button',
                  disabled: pending !== '',
                  'aria-label': `Remove ${s.skill_name} from ${typeLabel(cap.artifact_type)}`,
                  onClick: () => void send('DELETE', cap.artifact_type, s.skill_name),
                },
                'Remove',
              ),
            ),
          ),
        ),
        addable.length > 0
          ? createElement(
              'p',
              null,
              createElement('label', { htmlFor: addId }, 'Add skill: '),
              createElement(
                'select',
                {
                  id: addId,
                  name: addId,
                  value: selected,
                  onChange: (e: { target: { value: string } }) =>
                    setAdds({ ...adds, [cap.artifact_type]: e.target.value }),
                },
                ...addable.map((s) => createElement('option', { key: s, value: s }, s)),
              ),
              ' ',
              createElement(
                'button',
                {
                  type: 'button',
                  disabled: pending !== '' || selected === '',
                  onClick: () => void send('POST', cap.artifact_type, selected),
                },
                'Add',
              ),
            )
          : createElement('p', { 'data-all-added': true }, 'All library skills mapped.'),
      );
    }),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, message),
  );
}
