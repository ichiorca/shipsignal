// Drafting — start a new launch (reskin to mirror hindsight-guild's Drafting.tsx). The create-run
// surface, lifted out of the home page's progressive-disclosure <details> into its own workspace.
// Server Component shell hosting two interactive leaves: NewReleaseRunForm (the manual compare-range
// entry point) and LoadSampleButton (seed a synthetic run for a live demo). P6 (WCAG 2.2 AA): one
// <main> landmark, the PageHeader title is the page <h1>, and each content card is a labelled
// <section> led by an <h2>; the form/button own their own labels + live regions.

import { PageHeader } from '@/app/components/PageHeader.ts';
import { NewReleaseRunForm } from '@/app/components/NewReleaseRunForm.ts';
import { LoadSampleButton } from '@/app/components/LoadSampleButton.ts';

export const dynamic = 'force-dynamic';

export default function DraftingPage() {
  return (
    <main id="main">
      <PageHeader
        eyebrow="Decisions"
        title="Drafting"
        description="Start a new launch: turn a release into evidence-backed content."
      />
      {/* The primary create surface — a real compare-range release run. */}
      <section aria-labelledby="new-launch-heading">
        <h2 id="new-launch-heading">New launch</h2>
        <p>
          Point ShipSignal at a repository and a compare range. It collects evidence, extracts
          deterministic signals, and clusters them into a feature manifest for your approval — no
          marketing copy is generated from raw diffs.
        </p>
        <NewReleaseRunForm />
      </section>
      {/* A one-click path to a fully-populated synthetic run — time-to-wow with no GitHub token. */}
      <section aria-labelledby="sample-release-heading">
        <h2 id="sample-release-heading">Load a sample release</h2>
        <p>
          No repository handy? Seed a synthetic, fully-populated run to explore the whole loop —
          evidence, feature manifest, generated artifacts, and the approval gates.
        </p>
        <LoadSampleButton />
      </section>
    </main>
  );
}
