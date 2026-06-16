// T5 (spec 002) — run-detail page: shows a release run and its REDACTED evidence
// (PRD §13.1, §6.3). Server Component: it reads Aurora server-side; no secret or DB
// handle, and no raw excerpt, ever reaches the client. P6 (WCAG 2.2 AA): one <main>
// landmark with a heading and the semantic EvidenceTable. Raw blobs are reachable only
// via the presigned-access route the table links to (constitution §4/§5).

import { notFound } from 'next/navigation';
import { getReleaseRun } from '@/app/lib/db/releaseRuns.ts';
import { nextStep, buildPipeline } from '@/app/lib/runProgress.ts';
import { RunPipeline } from '@/app/components/RunPipeline.ts';
import { listEvidenceForRun } from '@/app/lib/db/evidenceItems.ts';
import { getRunCostBreakdown } from '@/app/lib/db/modelCallTelemetry.ts';
import { listArtifactRefsForRun } from '@/app/lib/db/artifacts.ts';
import { getRunEngagementByType } from '@/app/lib/db/engagementMetrics.ts';
import { buildRoiSummary } from '@/app/lib/engagement.ts';
import { EvidenceFeed } from '@/app/components/EvidenceFeed.ts';
import { CategorizedSignals } from '@/app/components/CategorizedSignals.ts';
import { RoiBreakdown } from '@/app/components/RoiBreakdown.ts';
import { humanizeStatus, formatTimestamp } from '@/app/lib/displayFormat.ts';

// Always reflect the latest evidence for the run; not statically cacheable.
export const dynamic = 'force-dynamic';

interface RunDetailPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function RunDetailPage({ params }: RunDetailPageProps) {
  const { id } = await params;
  const run = await getReleaseRun(id);
  if (run === null) {
    notFound();
  }

  // T5 (spec 021): the cost-vs-outcome summary renders on the run detail too, so a
  // reviewer sees "what it cost and what it got" without leaving the run.
  const [evidence, breakdown, artifacts, engagement] = await Promise.all([
    listEvidenceForRun(run.id),
    getRunCostBreakdown(run.id),
    listArtifactRefsForRun(run.id),
    getRunEngagementByType(run.id),
  ]);
  const roi = buildRoiSummary(
    [...new Set(artifacts.map((a) => a.artifact_type))],
    engagement,
    breakdown,
  );
  const next = nextStep(run);
  // UI tier-1 #2: the lifecycle stepper — where the run is, what's next, only reachable stages link.
  const pipeline = buildPipeline(run);

  // Every screen that exists for a run, in pipeline order. Previously Media, Gate #3
  // skills review, and Evals had no link in from the run and were reachable only by URL.
  const sections: ReadonlyArray<{ readonly label: string; readonly href: string }> = [
    { label: 'Review feature manifest (Gate #1)', href: `/releases/${run.id}/review` },
    { label: 'Draft artifacts', href: `/releases/${run.id}/artifacts` },
    { label: 'Review artifacts (Gate #2)', href: `/releases/${run.id}/artifacts/review` },
    { label: 'Demo media', href: `/releases/${run.id}/media` },
    { label: 'Review skill revisions (Gate #3)', href: `/releases/${run.id}/skills/review` },
    { label: 'Evaluations', href: `/releases/${run.id}/evals` },
    { label: 'Model cost & latency', href: `/releases/${run.id}/cost` },
  ];

  return (
    <main id="main">
      <nav aria-label="Breadcrumb">
        <a href="/">← All launches</a>
      </nav>
      <h1>
        {run.repo} <span data-run-range>· {run.base_ref}…{run.head_ref}</span>
      </h1>

      {next !== null ? (
        <p role="status">
          Next step: <a href={next.href}>{next.label}</a>
        </p>
      ) : (
        <p>
          Current status: <strong>{humanizeStatus(run.status)}</strong>. No reviewer action is
          required right now.
        </p>
      )}

      <RunPipeline stages={pipeline} />

      <nav aria-label="Run sections">
        <h2>Jump to a screen</h2>
        <ul>
          {sections.map((section) => (
            <li key={section.href}>
              <a href={section.href}>{section.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <dl>
        <dt>Compare range</dt>
        <dd>
          {run.base_ref}…{run.head_ref}
        </dd>
        <dt>Status</dt>
        <dd data-status={run.status}>{humanizeStatus(run.status)}</dd>
        <dt>Trigger</dt>
        <dd>{humanizeStatus(run.trigger_type)}</dd>
        <dt>Started</dt>
        <dd>
          <time dateTime={run.started_at}>{formatTimestamp(run.started_at)}</time>
        </dd>
      </dl>

      <section aria-labelledby="run-roi-heading">
        <h2 id="run-roi-heading">Cost vs outcome</h2>
        <RoiBreakdown summary={roi} />
        <p>
          <a href={`/releases/${run.id}/cost`}>
            Full cost &amp; latency breakdown, and engagement CSV upload
          </a>
        </p>
      </section>

      <h2>Signals by type</h2>
      <CategorizedSignals items={evidence} />

      <h2>Evidence</h2>
      <p>{evidence.length === 1 ? '1 item' : `${evidence.length} items`}</p>
      {/* Frontend audit (gap #2) — search + pagination around the evidence table. */}
      <EvidenceFeed items={evidence} />
    </main>
  );
}
