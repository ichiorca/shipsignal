# v1.0 Definition-of-Done verification (spec 012, T5)

> Maps every constitution §8 DoD item and §6 quality bar to where it is satisfied/verified, so
> the v1.0 sign-off is auditable rather than asserted. The structural halves (loop complete, no
> non-goal introduced) are enforced executably by `worker/tests/test_dod_verification.py`; the
> rest cite the module/test/workflow that carries them.

## §8 — Definition of Done

| DoD item | Where it is satisfied | Verified by |
|---|---|---|
| Full loop runs end-to-end (trigger → evidence → signals → features → **Gate #1** → artifacts → claims/checks → **Gate #2** → media → learning → **Gate #3** → `SKILL.md` replaced + SHA) | The four graphs chained by `loop_orchestration` + `__main__` `--graph` phases; `release-run.yml` dispatches each | `test_loop_orchestration.py`, `test_dod_verification.py`, `e2e/full-loop.spec.ts` |
| Same `thread_id` resumed at each gate | `loop_orchestration.thread_id_for` (deterministic per `(run, phase)`); resume reuses it | `test_loop_orchestration.py::test_thread_id_is_deterministic…` |
| Every shipped artifact has claim-level provenance; nothing publishes without its gate | claim extraction + evidence linking (spec 006); three `interrupt` gates | `test_claim_nodes.py`, gate e2e specs |
| All §6 quality bars green on `main` | see §6 table below | CI (`.github/workflows/ci.yml`) |
| Dashboard supports release/feature/artifact/skill review, keyboard-operable + WCAG 2.2 AA | `app/releases/**` review surfaces | `tests/*.a11y.test.ts`, gate e2e specs |
| No secrets in code/logs/DB/client; redaction verified; GDPR erasure across Aurora + S3 | redaction node, log scrubbing, erasure (specs 002/010) | `test_redaction*.py`, `test_log_scrubbing.py`, `test_erasure.py`, `evals/graders/*` |
| Reproduces on a clean Actions runner from documented env/secrets | `docs/reproducibility.md` + `release-run.yml` (all four graphs) | doc + workflow review |
| No deferred non-goal silently introduced (autopublish, AI video, multi-VCS, Step Functions/EventBridge/Lambda, KBs/Agents) | no such service/dep is constructed in the worker | `test_dod_verification.py::test_no_forbidden_aws_service_client…`, `…no_direct_provider_sdk…` |

## §6 — Quality bars

| Bar | Gate |
|---|---|
| Type-check: `tsc --noEmit` (TS) + `mypy` (Py) clean | `npm run typecheck`; CI |
| Lint/format: `ruff` (Py) + ESLint/Prettier (TS) clean | `ruff check .`; CI |
| Tests: `pytest` + TS unit suite + Playwright e2e for every gate/artifact-review flow | `npm test && pytest -q`; `e2e/*.spec.ts` (incl. `full-loop.spec.ts`) |
| DB: Alembic migration check, no drift | CI `migration-check` (upgrade → downgrade base → upgrade) |
| Privacy/domain evals: CRITICAL + HIGH at zero failures | CI `privacy-evals` (`evals/graders/{gdpr-compliance,privacy-eval}.sh`) |
| A11y: WCAG 2.2 AA on changed screens | `tests/*.a11y.test.ts` (axe, semantic markup, keyboard) |
| Coverage ≥ 80% on new/changed; provenance + redaction explicitly tested | unit suites per module |
| Cost/latency within budget; no untracked model-tier upgrade | CI `cost-latency-eval` (`evals/graders/cost-latency.sh`) |

## Manual sign-off (operator, on a real release run)

The automated guards above cover structure and unit behavior. The constitution §8 line "redaction
verified on a real release run; GDPR erasure verified across Aurora + S3" and "the full loop runs
end-to-end on the Actions runner" require one operator pass on real infrastructure — follow
`docs/reproducibility.md` steps 1–6 against a seeded run, then confirm: (a) each gate halted and
required a human decision, (b) the same thread resumed at each, (c) the final `SKILL.md` write
recorded its commit SHA in Aurora, (d) no PII appears in logs/telemetry. This pass cannot run in
the unit gate (it needs Aurora/AWS), so it is recorded here rather than asserted by a test.
