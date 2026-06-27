// /agents — operator editor for the agent→capability mapping (migration 0035). Per agent (pipeline
// stage) you can remove a producible artifact type or add one from the artifact-type vocabulary;
// each edit is persisted as an operator override (POST/DELETE → /api/settings/agents) and the worker
// gates generation by the resulting allowlist (a type disabled here is never produced). Removing the
// last type reverts the agent to its code default (content-generation → every type). Client island:
// createElement (dependency-free a11y harness); VALUE imports relative, type imports via '@/' alias.

'use client';

import { createElement, useState } from 'react';
import type { ReactElement } from 'react';
import type { AgentCapabilityMapping } from '@/app/lib/db/agentCapabilities.ts';
import { clientFetch } from '../lib/clientFetch.ts';
import { typeLabel } from '../lib/artifactTypes.ts';
import { agentLabel } from '../lib/agentStages.ts';

export interface AgentCapabilitiesEditorProps {
  readonly agents: readonly AgentCapabilityMapping[];
  readonly availableTypes: readonly string[];
}

export function AgentCapabilitiesEditor({
  agents,
  availableTypes,
}: AgentCapabilitiesEditorProps): ReactElement {
  const [pending, setPending] = useState('');
  const [message, setMessage] = useState('');
  const [adds, setAdds] = useState<Record<string, string>>({});

  async function send(
    method: 'POST' | 'DELETE',
    agentId: string,
    artifactType: string,
  ): Promise<void> {
    setPending(`${agentId}:${artifactType}`);
    setMessage(method === 'DELETE' ? 'Removing…' : 'Adding…');
    try {
      const response = await clientFetch('/api/settings/agents', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, artifact_type: artifactType }),
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
    { 'data-agent-editor': true },
    ...agents.map((agent) => {
      const mapped = new Set(agent.capabilities.map((c) => c.artifact_type));
      const addable = availableTypes.filter((t) => !mapped.has(t));
      const selected = adds[agent.agent_id] ?? addable[0] ?? '';
      const addId = `add-${agent.agent_id}`;
      return createElement(
        'section',
        { key: agent.agent_id, 'data-agent': agent.agent_id },
        createElement('h3', null, agentLabel(agent.agent_id)),
        createElement(
          'ul',
          { 'data-agent-caps': true },
          ...agent.capabilities.map((c) =>
            createElement(
              'li',
              { key: c.artifact_type, 'data-agent-cap': c.artifact_type },
              `${typeLabel(c.artifact_type)} — `,
              createElement(
                'span',
                { 'data-source': c.source },
                c.source === 'operator-override' ? 'override' : 'default',
              ),
              ' ',
              createElement(
                'button',
                {
                  type: 'button',
                  disabled: pending !== '',
                  'aria-label': `Remove ${typeLabel(c.artifact_type)} from ${agentLabel(agent.agent_id)}`,
                  onClick: () => void send('DELETE', agent.agent_id, c.artifact_type),
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
              createElement('label', { htmlFor: addId }, 'Add capability: '),
              createElement(
                'select',
                {
                  id: addId,
                  name: addId,
                  value: selected,
                  onChange: (e: { target: { value: string } }) =>
                    setAdds({ ...adds, [agent.agent_id]: e.target.value }),
                },
                ...addable.map((t) => createElement('option', { key: t, value: t }, typeLabel(t))),
              ),
              ' ',
              createElement(
                'button',
                {
                  type: 'button',
                  disabled: pending !== '' || selected === '',
                  onClick: () => void send('POST', agent.agent_id, selected),
                },
                'Add',
              ),
            )
          : createElement('p', { 'data-all-added': true }, 'All artifact types mapped.'),
      );
    }),
    createElement('p', { role: 'status', 'aria-live': 'polite' }, message),
  );
}
