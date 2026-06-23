// Path B / Phase 1 — Admin hub. The home for configuration & trust: the brand voice that grounds
// generation, the channel connections (Phase 3), the self-learning skill ledger, and the approval/
// trust machinery. Separating this from Author/Distribute is the audit's core IA fix — authoring,
// distribution, and administration are no longer flattened into one pipeline view. Server Component.

import { SectionHub, type HubCard } from '@/app/components/SectionHub.ts';

export const dynamic = 'force-dynamic';

const CARDS: readonly HubCard[] = [
  {
    title: 'Brand voice',
    description: 'Author your company voice — the voice guide (tone, reading level, do/don’t rules, vocabulary) and the example posts every draft is written in.',
    href: '/voice',
  },
  {
    title: 'Audience & messaging',
    description: 'Define who you market to (ICP segments) and the approved, evidence-backed claims generation may make.',
    href: '/settings',
  },
  {
    title: 'Projects & repositories',
    description: 'Pre-configure repos and map each to a GitHub credential (AWS Secrets Manager), so runs can target a saved project.',
    href: '/projects',
  },
  {
    title: 'Connections',
    description: 'Link your LinkedIn page and X account so approved posts can publish directly.',
    soon: true,
  },
  {
    title: 'Skills & learning',
    description: 'The repo skills that shape generation and the candidate revisions the system proposes from your edits.',
    href: '/skills',
  },
  {
    title: 'Webhook deliveries',
    description: 'The distribution webhook ledger — what shipped, delivery status, and failures to retry.',
    href: '/webhooks',
  },
];

export default function AdminPage() {
  return (
    <main id="main">
      <SectionHub
        eyebrow="Settings"
        title="Admin"
        intro="Configure the brand voice, channel connections, and the learning that keeps output on-message and trustworthy."
        cards={CARDS}
      />
    </main>
  );
}
