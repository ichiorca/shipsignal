# Release status model completion, dashboard read APIs, and skill admin surface

> PRD anchors: 13.2 Release status model; 13.3 Skill candidate status model; 14.1–14.4 read APIs; 13.1 Skill admin + Claim inspector screens

## Summary

The dashboard/API read surface is materially incomplete. The release status type implements only 4 of the 12 PRD states (a test even asserts PRD states are invalid), the PRD's GET list/detail and the entire `/api/skills*` read family don't exist as routes (data is fetched only by Server Components), and the Skill-admin screen plus a standalone Claim-inspector are missing. Close the read surface so the product matches the PRD contract and the lifecycle is observable.

## Acceptance criteria

- The release status type supports all 12 §13.2 states (created … completed/failed/cancelled), transitions are validated, and the run advances through them as the graph progresses.
- The skill-candidate status type supports all 7 §13.3 states (draft … suppressed_duplicate) via a shared, tested guard.
- GET read APIs exist per §14: `GET /api/releases/{id}`, `GET /api/releases/{id}/features`, `GET /api/releases/{id}/artifacts`, `GET /api/artifacts/{id}`, and the `/api/skills` family (`GET /api/skills`, `/api/skills/{name}`, `/api/skills/candidates`, `/api/skills/candidates/{id}`). Each does real work and returns typed data.
- A Skill-admin screen shows active repo skills + Aurora snapshots; a standalone Claim-inspector screen shows claim, support status, evidence links, and risk flags.
- No regression to the existing mutation/gate endpoints; new GET routes are read-only.
