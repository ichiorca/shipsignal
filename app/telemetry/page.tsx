// /telemetry — "Quality Signals" in the reskinned "Signals & Trends" section, mirroring
// hindsight-guild's Telemetry route. ShipSignal's quality signal is the per-run LLM-as-judge
// rubric (eval_runs.rubric_json) plus drift and claim-level provenance. There is no cross-run
// rubric aggregate read in this codebase, so this page does NOT fabricate one: it lists recent
// launches with a drill-down into each launch's /evals rubric, and explains the eight rubric
// dimensions statically. Server Component: reads Aurora server-side (no secret/DB handle reaches
// the client). P6 (WCAG 2.2 AA): one <main> landmark; PageHeader title is the page <h1>; the run
// list is a captioned semantic table; the rubric explainer is a semantic list.

import { listReleaseRuns } from '@/app/lib/db/releaseRuns.ts';
import { listRubricTrendAcrossRuns } from '@/app/lib/db/evalRuns.ts';
import { RUBRIC_DIMENSIONS, RUBRIC_SCORE_MAX } from '@/app/lib/rubricView.ts';
import { statusCategory, STATUS_CATEGORY_LABEL } from '@/app/lib/runProgress.ts';
import { humanizeStatus, formatTimestamp, relativeTime } from '@/app/lib/displayFormat.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';
import { BarChart } from '@/app/components/BarChart.ts';

// Always reflect the latest launches and their eval state.
export const dynamic = 'force-dynamic';

export default async function TelemetryPage() {
  const [runs, trend] = await Promise.all([listReleaseRuns(25), listRubricTrendAcrossRuns(50)]);
  // Only points where a rubric was actually scored carry a trend value.
  const scored = trend.filter((p): p is typeof p & { overall: number } => p.overall !== null);
  const drift = scored.length >= 2 ? scored[scored.length - 1]!.overall - scored[0]!.overall : null;

  return (
    <main id="main">
      <PageHeader
        eyebrow="Signals & Trends"
        title="Quality Signals"
        description="Eval rubric scores, drift, and claim-level provenance."
      />

      <section aria-labelledby="quality-what-heading">
        <h2 id="quality-what-heading">What "Quality Signals" means</h2>
        <p>
          Before any artifact reaches Gate #2 it is scored by an LLM-as-judge rubric and run through
          deterministic checks. "Quality Signals" is the operator&apos;s view onto three things:
        </p>
        <ul>
          <li>
            <strong>Rubric</strong> — each approved artifact is scored 1–5 on eight dimensions; the
            per-launch averages live on that launch&apos;s evals page.
          </li>
          <li>
            <strong>Drift</strong> — how the overall rubric moves across launches over time (the
            trend below); reviewer-edit drift lives in <a href="/learning">Self-Learning</a>.
          </li>
          <li>
            <strong>Provenance</strong> — every shipped claim is linked to concrete evidence; an
            unlinkable claim is never persisted as approved.
          </li>
        </ul>
      </section>

      <section aria-labelledby="rubric-trend-heading">
        <h2 id="rubric-trend-heading">Rubric trend &amp; drift</h2>
        {scored.length === 0 ? (
          <p>
            No rubric scores recorded yet — approve artifacts at Gate #2 and run the eval step, and
            each launch&apos;s overall rubric will plot here.
          </p>
        ) : (
          <>
            <p
              data-trend-headline
              data-direction={drift === null ? undefined : drift >= 0 ? 'improving' : 'worsening'}
            >
              {drift === null
                ? `Latest overall rubric: ${scored[scored.length - 1]!.overall.toFixed(2)} / ${RUBRIC_SCORE_MAX}.`
                : `Rubric drift: ${drift >= 0 ? '+' : ''}${drift.toFixed(2)} across ${scored.length} launches ` +
                  `(${scored[0]!.overall.toFixed(2)} → ${scored[scored.length - 1]!.overall.toFixed(2)} / ${RUBRIC_SCORE_MAX}).`}
            </p>
            <BarChart
              caption="Overall rubric score by launch (oldest first, out of 5)"
              labelHeader="Launch"
              valueHeader="Overall rubric"
              max={RUBRIC_SCORE_MAX}
              data={scored.map((p) => ({
                label: `${p.repo} ${p.release_run_id.slice(0, 6)}…`,
                value: p.overall,
                href: `/releases/${p.release_run_id}/evals`,
                title: p.release_run_id,
              }))}
              formatValue={(s) => `${s.toFixed(2)} / ${RUBRIC_SCORE_MAX}`}
            />
          </>
        )}
      </section>

      <section aria-labelledby="rubric-dimensions-heading">
        <h2 id="rubric-dimensions-heading">The eight rubric dimensions</h2>
        <p>
          The judge scores each dimension 1–5; the trend above rolls them into one overall score per
          launch. Open a launch below for its per-dimension averages.
        </p>
        <ol>
          {RUBRIC_DIMENSIONS.map((dimension) => (
            <li key={dimension.key}>{dimension.label}</li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="recent-launches-heading">
        <h2 id="recent-launches-heading">Recent launches</h2>
        <p>
          Open a launch to inspect its rubric scores, drift, and provenance. Counts cover the most
          recent {runs.length === 1 ? '1 launch' : `${runs.length} launches`}.
        </p>
        <table>
          <caption>Recent launches (newest first)</caption>
          <thead>
            <tr>
              <th scope="col">Launch</th>
              <th scope="col">Repository</th>
              <th scope="col">Stage</th>
              <th scope="col">Started</th>
              <th scope="col">Rubric</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  No launches yet. Trigger a release run to generate evaluated artifacts.
                </td>
              </tr>
            ) : (
              runs.map((run) => {
                const category = statusCategory(run.status);
                return (
                  <tr key={run.id}>
                    <th scope="row">
                      <a href={`/releases/${run.id}`} title={run.id}>
                        <code>{run.id.slice(0, 8)}…</code>
                      </a>
                    </th>
                    <td>
                      <code>{run.repo}</code>
                    </td>
                    <td data-status={category} data-status-category={category}>
                      <span>{STATUS_CATEGORY_LABEL[category]}</span>
                      {' — '}
                      {humanizeStatus(run.status)}
                    </td>
                    <td>
                      <time dateTime={run.started_at} title={formatTimestamp(run.started_at)}>
                        {relativeTime(run.started_at)}
                      </time>
                    </td>
                    <td>
                      <a href={`/releases/${run.id}/evals`}>View rubric</a>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
