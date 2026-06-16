---
name: path-b-product-direction
description: Product direction decisions for Path B — making the four-verb tagline (Reads/Writes/Records/Publishes) real
metadata:
  type: project
---

The product is being taken down **Path B**: build the product layer so the tagline is literally true (Reads repo+releases+calls / Writes blog+LinkedIn+HN+X in founder voice / Records demo videos+posts / Publishes when audience is awake + routes inbound). Today it's a strong evidence-grounded engine wrapped in an engineer's pipeline console; the loop doesn't close in-app (writes social content it can't publish; no scheduling; no call ingestion).

**Operator decisions (2026-06-15):**
- **Channels:** LinkedIn + X first. **Hacker News = assisted only** (no official submit API — prepare post + deep-link to submit). **No Mastodon.**
- **Publish mode:** `approve-then-schedule` vs `manual-click` is an **env-controlled flag** so the operator can switch easily. NOTE: "approve-then-schedule" still requires every artifact to pass Gate #2 — it only defers *execution* of an approved decision. This is the §2/§5 interpretation that must be ratified before Phase 3/4 ship (it's adjacent to the "no full autopublish" non-goal).
- **LinkedIn target:** company **page** (personal-profile posting is API-restricted) — shapes the "founder's voice" UX.

**Phased plan:** P1 job-based IA reskin (Author/Distribute/Measure/Admin, rename run→launch etc., lead-with-value) — frontend-only, no approvals. P2 add x_post + hackernews_post artifact types (+ format skills). P3 publish to LinkedIn/X via the outbound delivery ledger + connections/OAuth. P4 approve-then-schedule + send-time (GitHub Actions cron polling Aurora; constitution forbids Step Functions/EventBridge). P5 customer-call ingestion (redaction-first, GDPR) + inbound routing.

**Gate-0 decision (2026-06-15): D1–D4 APPROVED, D5 acknowledged** (see `docs/gate-0-approval-request.md`). Carve-out: **OAuth deferred** — this is a hackathon, no auth-enforcement machinery. Phase 3 publishing authorizes via **env-provided channel credentials** (server-side, §5-compliant — never DB/log/client), one shared account per channel (single-org tenancy). So: NO `connections` table / OAuth authorize-callback-refresh flow; channel config = "is the env credential set?". `scheduled_publishes` table + GitHub-Actions-cron-polling-Aurora scheduler (D3) stand. `PUBLISH_MODE` env flag: `manual` (default, safe) vs `scheduled` (approve-then-schedule). Channels: LinkedIn company page + X (egress-allowlisted); HN assisted-only.

**Phase 5 (customer-call ingestion + inbound routing) is DEFERRED** by operator decision 2026-06-15 — not built for the hackathon; the PII/GDPR work (redaction of call transcripts, consent/lawful-basis, DPIA, privacy-eval extension) is commercial-grade and doesn't pay off in a demo. Operator will approve post-hackathon for the commercial version. Gate-0b request (`docs/gate-0b-approval-request.md`) stays on file, ready to action then. **Status of the four verbs: Writes/Records/Publishes shipped (Phases 1–4, all green); Reads is repo+releases only (calls deferred).** See [[ui-component-conventions]] for how P-series components must be authored.
