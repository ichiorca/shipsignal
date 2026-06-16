// "Load sample release" (operator feedback 2026-06-09, priority 5): seed a fully-populated
// SYNTHETIC release run — evidence, approved features, draft + approved + blocked artifacts
// with claims and evidence links, an approved snapshot, engagement, eval rows, and model
// telemetry — so the dashboard demos in seconds with no GitHub token, Actions runner, or
// Bedrock access. Two completed background runs are seeded alongside, so the hero stats and
// the learning trend have a cross-run story to tell.
//
// P5 / domain-gdpr: every value is fixture data for a fictitious product (no real names,
// URLs, or PII — the same posture as the Playwright fixtures). All writes happen in ONE
// transaction with fresh UUIDs per invocation, so repeated clicks stack clean, independent
// sample runs and a partial failure leaves nothing behind. constitution §5 is honoured by
// shape: the approved artifact carries supported, evidence-linked claims; the blocked one
// carries the unsupported claim that blocked it (the safety story, demonstrated).

import { randomUUID } from 'node:crypto';
import { withTransaction } from '@/app/lib/aurora.ts';
import { artifactContentHash } from '@/app/lib/contentHash.ts';

const REPO = 'acme/launchpad';

interface SeededRun {
  readonly runId: string;
}

const CHANGELOG_TITLE = 'Reusable onboarding checklists';
const CHANGELOG_BODY =
  'Admins can now create **reusable onboarding checklists** and assign them to any team. ' +
  'Checklists support per-step owners and due dates, and progress is visible from the team dashboard.';

const BLOG_TITLE = 'Launchpad 1.13: onboarding that runs itself';
const BLOG_BODY =
  '# Launchpad 1.13: onboarding that runs itself\n\n' +
  'This release introduces reusable onboarding checklists, per-step owners, and a team progress view.\n\n' +
  '## Why it matters\n\nNew-hire setup used to be a copy-pasted doc; it is now a tracked, repeatable flow.';

// The eight rubric dimensions the worker scores 1..5 (worker eval_rubric.py / app rubricView.ts).
// Background runs improve over time so the cross-run Quality-Signals trend shows positive drift:
// 3w ago (mean 3.25) → 2w ago (mean 3.75) → showcase run (mean ~4.4).
const BG_RUBRIC: Readonly<Record<number, Readonly<Record<string, number>>>> = {
  3: { claim_support: 3, claim_risk: 4, brand_voice: 3, audience_relevance: 3, originality: 3, conversion_intent: 3, clarity: 4, demoability: 3 },
  2: { claim_support: 4, claim_risk: 4, brand_voice: 4, audience_relevance: 3, originality: 4, conversion_intent: 3, clarity: 4, demoability: 4 },
};

/** Mean of a rubric dimension→score map — the single headline `score` stored alongside the map. */
function rubricMean(map: Readonly<Record<string, number>>): number {
  const values = Object.values(map);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export async function seedDemoRelease(): Promise<SeededRun> {
  return withTransaction(async (client) => {
    // Records which repo skills shaped one generated artifact (the Capabilities "Skill usage" read
    // aggregates these). node_name varies per artifact type so a cross-cutting skill like
    // brand-voice shows usage across multiple sites.
    const recordSkillUsage = async (
      runId: string,
      artifactId: string,
      nodeName: string,
      skillNames: readonly string[],
    ): Promise<void> => {
      for (const skillName of skillNames) {
        await client.query(
          `INSERT INTO skill_usage_events
             (release_run_id, artifact_id, graph_name, node_name, skill_name, skill_version,
              content_hash, usage_type)
           VALUES ($1, $2, 'content_generation_graph', $3, $4, 'v1', $5, 'generation')`,
          [runId, artifactId, nodeName, skillName, `demo-${skillName}-${artifactId.slice(0, 8)}`],
        );
      }
    };

    // --- two completed background runs: the cross-run trend + hero medians ----------
    let editDistance = 0.42;
    let rejectionRate = 0.33;
    for (const weeksAgo of [3, 2]) {
      const bgRunId = randomUUID();
      const bgArtifactId = randomUUID();
      await client.query(
        `INSERT INTO release_runs
           (id, repo, base_ref, head_ref, trigger_type, status, langgraph_thread_id, started_at, completed_at)
         VALUES ($1, $2, $3, $4, 'manual', 'completed', $5,
                 now() - make_interval(weeks => $6),
                 now() - make_interval(weeks => $6) + interval '55 minutes')`,
        [bgRunId, REPO, `v1.${10 + weeksAgo}.0`, `v1.${11 + weeksAgo}.0`, `demo-${bgRunId}`, weeksAgo],
      );
      await client.query(
        `INSERT INTO artifacts (id, release_run_id, artifact_type, title, body_markdown, status,
                                model_id, prompt_version)
         VALUES ($1, $2, 'changelog_entry', $3, $4, 'approved', 'demo-model', 'content-gen-v1')`,
        [bgArtifactId, bgRunId, `Sample changelog (${weeksAgo}w ago)`, 'Earlier sample release notes.'],
      );
      await client.query(
        `INSERT INTO approved_artifact_snapshots
           (artifact_id, release_run_id, artifact_type, model_id, prompt_version,
            skill_versions_json, evidence_ids_json, claim_support_json, reviewer,
            reviewer_decision, final_title, final_body_markdown, content_hash, generated_at, approved_at)
         VALUES ($1, $2, 'changelog_entry', 'demo-model', 'content-gen-v1',
                 '{}', '[]', '[]', 'demo-reviewer', 'approved', $3, $4, $5,
                 now() - make_interval(weeks => $6),
                 now() - make_interval(weeks => $6) + interval '48 minutes')`,
        [
          bgArtifactId,
          bgRunId,
          `Sample changelog (${weeksAgo}w ago)`,
          'Earlier sample release notes.',
          artifactContentHash(`Sample changelog (${weeksAgo}w ago)`, 'Earlier sample release notes.'),
          weeksAgo,
        ],
      );
      for (const [evalType, score] of [
        ['edit_distance', editDistance],
        ['feature_rejection_rate', rejectionRate],
      ] as const) {
        await client.query(
          `INSERT INTO eval_runs (release_run_id, eval_type, score, findings_json)
           VALUES ($1, $2, $3, '{"scope": "demo_seed"}')`,
          [bgRunId, evalType, score],
        );
      }
      await client.query(
        `INSERT INTO model_call_telemetry
           (release_run_id, node_name, model_id, model_tier, input_tokens, output_tokens,
            latency_ms, cost_usd_estimate)
         VALUES ($1, 'generate_artifacts_parallel', 'demo-model', 'standard', 18200, 5400, 9200, 1.12)`,
        [bgRunId],
      );
      // Rubric eval (the cross-run drift trend) + skill usage for this background changelog.
      const bgRubric = BG_RUBRIC[weeksAgo]!;
      await client.query(
        `INSERT INTO eval_runs (release_run_id, artifact_id, eval_type, score, rubric_json, findings_json)
         VALUES ($1, $2, 'rubric', $3, $4::jsonb, '{"scope": "demo_seed"}')`,
        [bgRunId, bgArtifactId, rubricMean(bgRubric), JSON.stringify(bgRubric)],
      );
      await recordSkillUsage(bgRunId, bgArtifactId, 'generate_changelog', [
        'changelog-format',
        'brand-voice',
        'product-context',
      ]);
      editDistance = 0.27;
      rejectionRate = 0.25;
    }

    // --- the showcase run: halted at Gate #2 with a rich review surface --------------
    const runId = randomUUID();
    await client.query(
      `INSERT INTO release_runs
         (id, repo, base_ref, head_ref, trigger_type, status, langgraph_thread_id, started_at)
       VALUES ($1, $2, 'v1.12.0', 'v1.13.0', 'manual', 'artifacts_pending_review', $3,
               now() - interval '42 minutes')`,
      [runId, REPO, `demo-${runId}`],
    );

    const evidenceIds = [randomUUID(), randomUUID(), randomUUID()];
    const evidence = [
      ['code_diff', 'src/checklists/templates.ts', 'Added ChecklistTemplate model with per-step owners and due dates.'],
      ['pr_description', null, 'PR #482: reusable onboarding checklists — templates, assignment, and team progress view.'],
      ['docs_change', 'docs/onboarding.md', 'Documented checklist templates and the team progress dashboard.'],
    ] as const;
    for (const [index, [type, filePath, excerpt]] of evidence.entries()) {
      await client.query(
        `INSERT INTO evidence_items
           (id, release_run_id, evidence_type, source, repo, file_path, redacted_excerpt, confidence)
         VALUES ($1, $2, $3, 'github', $4, $5, $6, 0.92)`,
        [evidenceIds[index], runId, type, REPO, filePath, excerpt],
      );
    }

    const featureId = randomUUID();
    await client.query(
      `INSERT INTO feature_clusters
         (id, release_run_id, title, user_value, marketability_score, demoability_score,
          confidence, status)
       VALUES ($1, $2, $3, $4, 0.86, 0.91, 0.88, 'approved')`,
      [featureId, runId, CHANGELOG_TITLE, 'Repeatable, tracked onboarding for every new team.'],
    );

    // Approved changelog (snapshot + supported claims + engagement): the publish story.
    const changelogId = randomUUID();
    const changelogClaimId = randomUUID();
    await client.query(
      `INSERT INTO artifacts (id, release_run_id, feature_id, artifact_type, title, body_markdown,
                              status, model_id, prompt_version)
       VALUES ($1, $2, $3, 'changelog_entry', $4, $5, 'approved', 'demo-model', 'content-gen-v1')`,
      [changelogId, runId, featureId, CHANGELOG_TITLE, CHANGELOG_BODY],
    );
    await client.query(
      `INSERT INTO artifact_claims (id, artifact_id, claim_text, claim_type, support_status, risk_level)
       VALUES ($1, $2, 'Admins can create reusable onboarding checklists with per-step owners.',
               'capability', 'supported', 'low')`,
      [changelogClaimId, changelogId],
    );
    await client.query(
      `INSERT INTO claim_evidence_links (claim_id, evidence_item_id, support_score)
       VALUES ($1, $2, 0.94), ($1, $3, 0.81)`,
      [changelogClaimId, evidenceIds[0], evidenceIds[1]],
    );
    const approvalId = randomUUID();
    await client.query(
      `INSERT INTO approvals (id, target_type, target_id, decision, reviewer)
       VALUES ($1, 'artifact', $2, 'approved', 'demo-reviewer')`,
      [approvalId, changelogId],
    );
    await client.query(
      `INSERT INTO approved_artifact_snapshots
         (artifact_id, release_run_id, approval_id, artifact_type, model_id, prompt_version,
          skill_versions_json, evidence_ids_json, claim_support_json, reviewer, reviewer_decision,
          final_title, final_body_markdown, content_hash, generated_at, approved_at)
       VALUES ($1, $2, $3, 'changelog_entry', 'demo-model', 'content-gen-v1',
               $4, $5, $6, 'demo-reviewer', 'approved', $7, $8, $9,
               now() - interval '35 minutes', now() - interval '4 minutes')`,
      [
        changelogId,
        runId,
        approvalId,
        JSON.stringify({ 'changelog-format': 'demo-hash-1', 'brand-voice': 'demo-hash-2' }),
        JSON.stringify([evidenceIds[0], evidenceIds[1]]),
        JSON.stringify([
          { claim_id: changelogClaimId, support_status: 'supported', risk_level: 'low' },
        ]),
        CHANGELOG_TITLE,
        CHANGELOG_BODY,
        artifactContentHash(CHANGELOG_TITLE, CHANGELOG_BODY),
      ],
    );
    for (const [metric, value] of [
      ['views', 1840],
      ['clicks', 214],
      ['conversions', 19],
    ] as const) {
      await client.query(
        `INSERT INTO engagement_metrics (release_run_id, artifact_id, metric, value, as_of, source)
         VALUES ($1, $2, $3, $4, current_date, 'api')`,
        [runId, changelogId, metric, value],
      );
    }

    // Pending blog draft (supported claim → approvable at the gate, live).
    const blogId = randomUUID();
    const blogClaimId = randomUUID();
    await client.query(
      `INSERT INTO artifacts (id, release_run_id, feature_id, artifact_type, title, body_markdown,
                              status, model_id, prompt_version)
       VALUES ($1, $2, $3, 'release_blog', $4, $5, 'draft', 'demo-model', 'content-gen-v1')`,
      [blogId, runId, featureId, BLOG_TITLE, BLOG_BODY],
    );
    await client.query(
      `INSERT INTO artifact_claims (id, artifact_id, claim_text, claim_type, support_status, risk_level)
       VALUES ($1, $2, 'Checklist progress is visible from the team dashboard.',
               'capability', 'supported', 'low')`,
      [blogClaimId, blogId],
    );
    await client.query(
      `INSERT INTO claim_evidence_links (claim_id, evidence_item_id, support_score)
       VALUES ($1, $2, 0.9)`,
      [blogClaimId, evidenceIds[2]],
    );

    // Blocked one-pager (unsupported fabricated-metric claim): the safety rails, visible.
    const onepagerId = randomUUID();
    await client.query(
      `INSERT INTO artifacts (id, release_run_id, feature_id, artifact_type, title, body_markdown,
                              status, model_id, prompt_version)
       VALUES ($1, $2, $3, 'sales_onepager', 'Onboarding checklists — sales one-pager',
               'Cuts onboarding time in half for every team.', 'blocked', 'demo-model', 'content-gen-v1')`,
      [onepagerId, runId, featureId],
    );
    await client.query(
      `INSERT INTO artifact_claims (id, artifact_id, claim_text, claim_type, support_status, risk_level)
       VALUES ($1, $2, 'Reduces onboarding time by 50%.', 'metric', 'unsupported', 'high')`,
      [randomUUID(), onepagerId],
    );

    // Run-level evals (the trend's newest point) + the model spend that proves the cost story.
    for (const [evalType, score] of [
      ['edit_distance', 0.12],
      ['feature_rejection_rate', 0.1],
      ['evidence_coverage', 1.0],
    ] as const) {
      await client.query(
        `INSERT INTO eval_runs (release_run_id, eval_type, score, findings_json)
         VALUES ($1, $2, $3, '{"scope": "demo_seed"}')`,
        [runId, evalType, score],
      );
    }
    await client.query(
      `INSERT INTO model_call_telemetry
         (release_run_id, node_name, model_id, model_tier, input_tokens, output_tokens,
          latency_ms, cost_usd_estimate)
       VALUES ($1, 'generate_artifacts_parallel', 'demo-model', 'standard', 14200, 4100, 8100, 0.61),
              ($1, 'extract_claims', 'demo-model', 'fast', 6200, 900, 2400, 0.23)`,
      [runId],
    );

    // Per-artifact rubric rows (the trend's newest, highest point — two artifacts scored, so the
    // Quality-Signals chart averages across them and shows artifact_count = 2).
    const showcaseRubrics: ReadonlyArray<readonly [string, Record<string, number>]> = [
      [changelogId, { claim_support: 5, claim_risk: 5, brand_voice: 4, audience_relevance: 4, originality: 4, conversion_intent: 4, clarity: 5, demoability: 4 }],
      [blogId, { claim_support: 5, claim_risk: 5, brand_voice: 5, audience_relevance: 4, originality: 4, conversion_intent: 4, clarity: 5, demoability: 4 }],
    ];
    for (const [artifactId, rubric] of showcaseRubrics) {
      await client.query(
        `INSERT INTO eval_runs (release_run_id, artifact_id, eval_type, score, rubric_json, findings_json)
         VALUES ($1, $2, 'rubric', $3, $4::jsonb, '{"scope": "demo_seed"}')`,
        [runId, artifactId, rubricMean(rubric), JSON.stringify(rubric)],
      );
    }

    // Skill usage for the showcase artifacts — brand-voice spans all three nodes, so the
    // Capabilities "Skill usage" read shows it leading on uses and sites.
    await recordSkillUsage(runId, changelogId, 'generate_changelog', [
      'changelog-format',
      'brand-voice',
      'product-context',
    ]);
    await recordSkillUsage(runId, blogId, 'generate_blog', [
      'blog-format',
      'brand-voice',
      'product-context',
      'audience-map',
    ]);
    await recordSkillUsage(runId, onepagerId, 'generate_onepager', [
      'sales-onepager-format',
      'brand-voice',
    ]);

    return { runId };
  });
}
