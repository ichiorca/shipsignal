# Gate-0 Approval Request — Path B, Phases 3–4 (Publish + Schedule)

**Status: ✅ APPROVED (2026-06-15) with one carve-out — OAuth deferred for the hackathon.**
**Requested by:** engineering (Path B implementation)
**Date raised:** 2026-06-15
**Blocks:** Phase 3 (publish to LinkedIn/X) and Phase 4 (send-time scheduling). Phases 1–2 are shipped and need no approval.

> ## Decision recorded (2026-06-15)
> D1, D2, D3, D4 **approved**; D5 acknowledged. **Carve-out:** per-account **OAuth connection
> flows are deferred** — this is a hackathon build and the operator does not want auth-enforcement
> machinery at this stage. Publishing authorizes via **env-provided channel credentials** read
> server-side at send time (e.g. `LINKEDIN_*`, `X_*`), one shared account per channel. This stays
> within §5 (secrets from env only; never in a DB column, log, S3, or the client). Consequences:
> - the `connections` table + OAuth authorize/callback/refresh workstream from D4 is **dropped**;
>   channel config is "is the env credential present?" — no per-user token storage.
> - `scheduled_publishes` (D4) and the Actions-cron scheduler (D3) are unchanged.
> - single-org / single-account only — consistent with the constitution's "internal single-org
>   tool" tenancy. Use a test/throwaway channel account for demos.

---

## TL;DR

Path B Phases 3–4 close the **Publishes** verb of the product tagline ("Ships when your audience is awake"). Per constitution **§7**, that work touches scope/non-goals, adds third-party services, alters storage shape, and creates new secret/IAM boundaries — so engineering MUST pause and get explicit operator sign-off before building. This document lists each item, the exact constitution clause in play, the proposed resolution, and the blast radius. **Five decisions** are requested; a sign-off checklist is at the end.

What is **not** changing: Bedrock stays the only model/safety path (§1); the three human gates stay mandatory (§5); redaction is untouched; no new VCS; the default runtime posture is the most conservative one.

---

## Context

- **Phase 1 (shipped):** job-based IA reskin (Author/Distribute/Measure/Admin), launch vocabulary. Frontend-only, no approvals.
- **Phase 2 (shipped):** `x_post` + `hackernews_post` artifact types + format skills. Content generation only, within the constitution.
- **Phase 3 (blocked, this request):** publish approved posts to **LinkedIn (company page)** and **X**. HN is **assisted-only** (no submit API) → no HN service/secret needed.
- **Phase 4 (blocked, this request):** **approve-then-schedule** so an approved post ships at a chosen/optimal time instead of at the moment of approval.

---

## The five decisions requested

### Decision 1 — Ratify "approve-then-schedule" as NOT autopublishing
**Clause:** §2 non-goal *"full autopublishing without human approval"*; §5 *"Three human gates are mandatory… No content publishes… without the corresponding gate resolving to approved."*

**Ask:** Confirm that deferring the **execution** of an already-Gate-#2-approved artifact to a scheduled time is *not* "autopublishing without human approval," and amend §5 to say so explicitly.

**Why it's compliant:** Every artifact still passes Gate #2 by a human. Scheduling moves only *when the approved bytes are sent*, never *whether* they're approved. This is categorically different from the deferred non-goal artifact type `autopublished_assets` (generate-and-ship with no human), which stays out of scope.

**Safety control:** an env flag `PUBLISH_MODE` with two values:
- `manual` *(default)* — approval never auto-executes; a human clicks "Publish" explicitly.
- `scheduled` — an approval may carry a publish time that executes mechanically.

The conservative mode is the default; `scheduled` is opt-in per deployment.

---

### Decision 2 — Approve LinkedIn + X as new outbound publish services
**Clause:** §1 *"no new service without operator approval"* (substrate); §7 *"add a service/dependency… modify a webhook/secret/IAM boundary."*

**Ask:** Approve adding **LinkedIn (organization/company-page posting)** and **X (post API)** as **publish-only egress** targets, including their OAuth connection flows.

**Scope guardrails:**
- These are **egress publish** integrations, not model/safety calls — §1's "model + safety via Bedrock exclusively" is untouched.
- Network egress to `api.linkedin.com` and the X API host must be **added to the harness egress allowlist** (§5 "network egress stays allowlisted").
- LinkedIn target is the **company page** (operator decision 2026-06-15), which uses organization-scoped permissions — not personal-profile automation.
- **No Hacker News service** — HN is prepare-and-assist only.

---

### Decision 3 — Confirm the scheduler design uses only sanctioned primitives
**Clause:** §1/§2 forbid *"Step Functions, EventBridge, Bedrock Agents, or bespoke job schedulers"* and *"Step Functions/EventBridge/Lambda/ECS."* §1 mandates *"Long jobs run on the GitHub Actions runner."*

**Ask:** Confirm the proposed executor is compliant (a clarification, not an exception):

> A **GitHub Actions `schedule:` cron** workflow wakes on an interval, polls an Aurora `scheduled_publishes` queue for rows that are **due AND Gate-#2-approved**, and invokes the Phase-3 publish adapters. State lives in Aurora; the trigger is the sanctioned Actions runner.

No Step Functions / EventBridge / Lambda / ECS / third-party scheduler is introduced. We are asking the operator to agree that "Actions cron + Aurora polling" is **not** a prohibited "bespoke job scheduler."

---

### Decision 4 — Approve the additive storage shape + secret handling
**Clause:** §4 *"secrets in any DB column, S3 object, or log"* is **forbidden**; §7 *"alter storage shape… modify a secret boundary."*

**Ask:** Approve two new **additive** Aurora tables and the token-handling rule below.

- `connections` — one row per connected channel account: `channel`, account/org id, granted scopes, status, `connected_by`, expiry, and a **secret reference** (AWS Secrets Manager ARN / key id) — **never the token itself**.
- `scheduled_publishes` — `artifact_id`, `channel`, `scheduled_at`, `status`, and the `approval_id` that authorized it (so a scheduled send is always traceable to its Gate #2 approval).
- Delivery records reuse the **existing `outbound_webhook_deliveries` ledger pattern** (already in production), surfaced in the Distribute dashboard built in the earlier audit work.

**Secret rule (binding):** OAuth access/refresh tokens live in **AWS Secrets Manager** (prod) / env, **never** in an Aurora column, S3 object, log line, or the React client (§4/§5). Token refresh is server-side only.

---

### Decision 5 — Confirm what stays unchanged (no implicit scope creep)
**Ask:** Acknowledge that this request does **not**:
- add any model/safety provider (Bedrock + Guardrails remain exclusive, §1);
- weaken the three human gates (§5) — publishing still requires Gate #2 approved;
- change the redaction-before-persist pipeline (§5);
- add multi-VCS support (§2) — LinkedIn/X are distribution channels, not source control;
- introduce `autopublished_assets` or any §2 non-goal artifact type.

---

## Proposed constitution amendments (exact wording for the operator to apply)

These edits to `memory/constitution.md` are **proposed**, not made — amending it is the operator's act.

**§2 Scope — clarify the autopublish non-goal:**
> *…full autopublishing without human approval (publishing or scheduling content that has **not** passed Gate #2 — note: scheduling the execution of an artifact that **has** passed Gate #2 is permitted)…*

**§5 Safety rails — add after the three-gates sentence:**
> *Approved artifacts (Gate #2) MAY be published immediately or on a schedule; scheduling defers only the mechanical send of already-approved content and never substitutes for a gate. The runtime publish posture is set by `PUBLISH_MODE` (default `manual`).*

**§2 / §1 — name the sanctioned channels + scheduler so future sessions don't re-flag them:**
> *Approved distribution channels: GitHub Releases, Slack, **LinkedIn (company page), X** (publish-only egress, allowlisted). Hacker News is assisted-only. Scheduled publishing runs on a **GitHub Actions cron workflow polling Aurora** — not Step Functions/EventBridge/Lambda/ECS or a bespoke scheduler.*

---

## Blast radius & rollback

- **Default-safe:** `PUBLISH_MODE=manual` means the very first deploy behaves exactly like today (a human clicks to publish) — scheduling is opt-in.
- **Opt-in connections:** nothing publishes anywhere until an operator explicitly connects a LinkedIn/X account.
- **Reversible:** disconnect a channel (revoke token in Secrets Manager + flip `connections.status`) and disable the cron workflow; queued sends stop. The new tables are additive (drop-on-downgrade).
- **Egress-bounded:** only the two allowlisted hosts are reachable; everything else stays denied.

---

## Out of scope for THIS request (separate Gate-0b later)

**Phase 5 — customer-call ingestion** (the "Reads customer calls" verb) is **not** requested here. Call transcripts are dense PII and require a dedicated **GDPR privacy review** under §5 (redaction-before-persist, erasure across Aurora+S3, lawful basis) plus its own ingestion-service approval. Raising it separately keeps Phases 3–4 unblocked without waiting on the heavier privacy work.

---

## Operator decision checklist

Please mark each:

- [x] **D1** — "Approve-then-schedule" ratified as not-autopublish; §5 to be amended; `PUBLISH_MODE` default `manual` accepted.
- [x] **D2** — LinkedIn (company page) + X approved as publish-only egress; hosts added to the allowlist.
- [x] **D3** — GitHub Actions cron + Aurora-polling scheduler confirmed compliant (not a prohibited scheduler).
- [x] **D4** — `scheduled_publishes` table approved; secrets stay env-only (never a DB column/log/client). **OAuth `connections`/token-storage deferred** — env credentials used instead (hackathon carve-out).
- [x] **D5** — Acknowledged: no change to Bedrock exclusivity, the three gates, redaction, VCS scope, or non-goal artifact types.

**Decision / signature:** operator (hackathon)  **Date:** 2026-06-15

> Approved 2026-06-15 with the OAuth carve-out above. Engineering may begin Phase 3/4 with
> env-credential publishing.
