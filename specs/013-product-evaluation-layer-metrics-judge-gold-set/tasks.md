# Tasks — Product evaluation layer — metrics, LLM-as-judge rubric, gold set, eval_runs

- [ ] **T1 — eval_runs migration + model** Reversible migration creating `eval_runs` per §10.7 (release_run_id, artifact_id, eval_type, score, rubric_json, findings_json) with FKs; ORM/model + Aurora write adapter.
- [ ] **T2 — Deterministic product metrics** Compute and persist §17.1 metrics (evidence coverage, unsupported-claim rate, edit distance, approval latency, feature rejection rate, skill-candidate acceptance rate, media success rate) scoped by release_run_id.
- [ ] **T3 — LLM-as-judge rubric** Rubric scorer via the `ModelClient` seam scoring the §17.2 dimensions; fail-closed on malformed output; human override recorded in eval findings.
- [ ] **T4 — Gold set + regression harness** Check in a small internal gold set (§17.3) and a runner that regression-tests graph/prompt/model changes against expected features and known risky claims.
- [ ] **T5 — Eval dashboard screen** Per-run eval view (unsupported-claim rate, edit distance, approval latency); keyboard-operable, WCAG 2.2 AA.
- [ ] **T6 — Wire eval into the loop + read API** Trigger eval after artifact approval; expose eval results via a read API/route consumed by the dashboard; no PII/prompt content in telemetry.
