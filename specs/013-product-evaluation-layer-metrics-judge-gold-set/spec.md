# Product evaluation layer — metrics, LLM-as-judge rubric, gold set, eval_runs

> PRD anchors: 17. Evaluation and Metrics (17.1 metrics, 17.2 rubric dimensions, 17.3 gold set); 10.7 eval_runs table; 13.1 Eval dashboard

## Summary

The product-quality evaluation layer specified in PRD §17 was never decomposed into a spec and is entirely absent: no metrics, no LLM-as-judge rubric, no gold set, no `eval_runs` persistence, and no Eval dashboard. (The existing `evals/*.cue` are harness-infrastructure gates, not PRD product metrics.) Build the real product-eval layer so reviewers can see content quality over time and so graph/prompt/model changes can be regression-tested.

## Acceptance criteria

- `eval_runs` table exists per §10.7 (id, release_run_id, artifact_id, eval_type, score numeric, rubric_json, findings_json, created_at), scoped by release_run_id/artifact_id; migration is reversible.
- Product-quality metrics (§17.1) are computed and persisted: evidence coverage, unsupported-claim rate, edit distance (reviewer rewrite amount), approval latency, feature rejection rate, skill-candidate acceptance rate, media success rate.
- An LLM-as-judge rubric (§17.2) runs through the existing `ModelClient` seam (no direct Bedrock) scoring claim support, claim risk, brand voice, audience relevance, originality, conversion intent, clarity, demoability; human-review overrides are recorded.
- A small internal gold set (§17.3) is checked in (prior-release boundaries, expected marketable features, approved copy, known non-marketable changes, known risky claims) and used to regression-test graph/prompt/model changes.
- An Eval dashboard screen renders unsupported-claim rate, edit distance, and approval latency per run; keyboard-operable, WCAG 2.2 AA.
- Eval runs are written after artifact approval; no PII or raw prompt content is stored in eval telemetry.
