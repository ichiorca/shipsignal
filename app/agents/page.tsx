// Reskin (peer parity with hindsight-guild/web Agents.tsx) — the "Agents" view. ShipSignal has no
// human agent roster: its "agents" are the LangGraph graphs/nodes that turn a release into launch
// content. This page presents an honest roster of those pipeline stages (the four graphs in
// worker/src/release_worker plus the eval stage), AND lets operators edit the agent→capability
// mapping (migration 0035): which artifact types each agent is allowed to produce. Only content-
// generation produces artifact-type capabilities; the other stages emit pipeline outputs (evidence,
// scores, the demo video, skill candidates), so they have no editable capabilities. The worker gates
// generation by this allowlist (DB-wins-per-agent over the code default). Server Component: reads
// Aurora server-side (no secret/DB handle reaches the client) and renders the client editor. P6
// (WCAG 2.2 AA): one <main> landmark, headed sections, labelled controls, polite status.

import { PageHeader } from '@/app/components/PageHeader.ts';
import { AgentCapabilitiesEditor } from '@/app/components/AgentCapabilitiesEditor.ts';
import { AGENT_STAGES } from '@/app/lib/agentStages.ts';
import { listAgentCapabilities } from '@/app/lib/db/agentCapabilities.ts';
import { ALL_ARTIFACT_TYPES } from '@/app/lib/artifactTypes.ts';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const agents = await listAgentCapabilities();
  const availableTypes = [...ALL_ARTIFACT_TYPES];

  return (
    <main id="main">
      <PageHeader
        eyebrow="Library"
        title="Agents"
        description="The team that turns a release into launch content — and which capabilities each agent owns."
      />

      <section aria-labelledby="roster-intro-heading">
        <h2 id="roster-intro-heading">The automated team</h2>
        <p>
          ShipSignal has no human agent roster. Its &ldquo;agents&rdquo; are the LangGraph graphs
          and nodes that do the work — each a stage in the pipeline that turns a release into
          approved launch content. Each stage below describes its role, what it does, and the
          human approval gate it feeds.
        </p>
      </section>

      <section aria-labelledby="agent-mapping-heading">
        <h2 id="agent-mapping-heading">Agent → capability mapping</h2>
        <p>
          {agents.length === 0
            ? 'No agent mapping is seeded yet — run the reference seeder (it loads the code-default ' +
              'mapping) and each agent and the artifact types it produces appear here.'
            : 'Which artifact-type capabilities each agent is allowed to produce. The worker gates ' +
              'generation by this exact allowlist — an operator edit wins per agent, otherwise the ' +
              'seeded code default applies; a type removed here is never produced even if a run ' +
              'selects it. Removing every capability from an agent reverts it to the code default. ' +
              'Only content generation produces artifact types — the other stages emit pipeline ' +
              'outputs (evidence, scores, the demo video, skill candidates), so they have no ' +
              'editable capabilities. The artifact types themselves and the skills that ground ' +
              'them live in '}
          {agents.length === 0 ? null : <a href="/capabilities">Capabilities</a>}
          {agents.length === 0 ? null : '.'}
        </p>
        {agents.length > 0 ? (
          <AgentCapabilitiesEditor agents={agents} availableTypes={availableTypes} />
        ) : null}
      </section>

      {AGENT_STAGES.map((stage) => (
        <section key={stage.id} aria-labelledby={`${stage.id}-heading`}>
          <h2 id={`${stage.id}-heading`}>{stage.name}</h2>
          <p>
            <strong>{stage.role}</strong>
          </p>
          <p>
            Graph: <code>{stage.graph}</code>
          </p>
          <ul>
            {stage.does.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>{stage.gate}</p>
          {stage.link !== undefined ? (
            <p>
              <a href={stage.link.href}>{stage.link.label}</a>
            </p>
          ) : null}
        </section>
      ))}
    </main>
  );
}
