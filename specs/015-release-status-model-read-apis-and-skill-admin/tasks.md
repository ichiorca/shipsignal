# Tasks — Release status model completion, dashboard read APIs, and skill admin surface

- [x] **T1 — Full release status model** Implement all 12 §13.2 states with validated transitions; advance the run through them as the graph progresses; update existing tests that assert the old 4-state model.
- [x] **T2 — Skill candidate status model** Shared TS enum/guard for all 7 §13.3 states, with tests.
- [x] **T3 — Release/feature/artifact read APIs** `GET /api/releases/{id}`, `/releases/{id}/features`, `/releases/{id}/artifacts`, `/api/artifacts/{id}` returning typed data from Aurora.
- [x] **T4 — Skills read API family** `GET /api/skills`, `/api/skills/{name}`, `/api/skills/candidates`, `/api/skills/candidates/{id}`.
- [x] **T5 — Skill admin + standalone claim inspector** Skill-admin screen (active repo skills + Aurora snapshots) and a standalone Claim-inspector screen; keyboard-operable, WCAG 2.2 AA.
