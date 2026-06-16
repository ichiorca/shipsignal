# Gate-0b Approval Request — Path B, Phase 5 (Reads customer calls + Routes inbound)

**Status: ⏸️ DEFERRED (operator decision 2026-06-15).** Phase 5 will not be built for the
hackathon. The operator will approve it post-hackathon, when building the commercial version —
the PII/GDPR infrastructure (call-transcript redaction, consent/lawful-basis, DPIA, privacy-eval
extension) is commercial-grade work that doesn't pay off in a demo. This document stays on file as
the ready-to-action request for that future decision.
**Requested by:** engineering (Path B implementation)
**Date raised:** 2026-06-15
**Blocks:** Phase 5 only. Phases 1–4 (the Writes/Records/Publishes verbs) are shipped and do not depend on this.

---

## TL;DR

Phase 5 closes the last tagline verb — **Reads … customer calls** — and the **Routes inbound back to you** half of Publishes. Both introduce **the highest-PII data this product has ever handled**: call transcripts are dense with names, contact details, opinions, and possibly special-category data (GDPR Art. 9). Per constitution **§5 (GDPR rails)** and **§7** ("any personal-data handling decision … is an escalation trigger"), engineering MUST get explicit operator sign-off before building. This is a privacy gate, not a feature gate.

Good news: the privacy **spine already exists** — `redaction.py`, `retention.py`, `erasure.py`, the daily `retention-sweep` workflow, and the CRITICAL/HIGH privacy eval suite (§6). Phase 5 routes call data **through** that spine rather than building a new one. The decisions below are about *scope, lawful basis, and a conservative ingestion path*, not about reinventing redaction.

**Recommendation for a hackathon:** approve the **minimal path** — manual upload of **synthetic / test** transcripts only, full redaction-first flow, no third-party call-tool integration, and **defer inbound routing**. That demonstrates "calls shape the launch" with near-zero real-PII risk.

---

## Context

- **Reads customer calls (D6–D9):** ingest a call transcript, redact it, extract release-relevant signals (feature requests, objections, language customers actually use), and link them as evidence to features — same provenance spine as GitHub evidence.
- **Routes inbound (D10):** capture replies/comments/leads on published posts and route them to the founder. Lower priority; also PII-bearing (commenter identities).

---

## The decisions requested

### D6 — Approve customer-call transcripts as a new evidence category (scope + new PII class)
**Clause:** §2 (in-scope is "GitHub-sourced … evidence collection" — calls are a *new* source); §7 (new data source + personal-data decision).

**Why it needs a decision:** a call transcript is a categorically different PII profile than a diff/PR — full names, personal opinions, and potentially **special-category data** (health, politics, etc. mentioned in passing). Approving it expands the data the system lawfully processes.

**Asks:**
- Establish and record a **lawful basis + purpose limitation** (evidence used *only* for release-content generation, never resold/profiled).
- **Data minimization:** persist only release-relevant *redacted snippets*, never whole raw transcripts.
- **Consent/notice is an operator responsibility:** the product cannot verify that a call was recorded with the required consent/notice (two-party-consent jurisdictions). Approving D6 includes acknowledging that only lawfully-recorded calls are fed in.

### D7 — Approve the ingestion source + its boundary (recommend: manual upload, no third-party service)
**Clause:** §1/§7 (new service / secret / inbound-webhook boundary).

**Asks (pick the scope):**
- **Recommended (hackathon):** **manual transcript upload** only — no Gong/Zoom/Fireflies/Otter integration, no new secret, no inbound webhook. Lowest surface.
- **Deferred:** a call-tool webhook (signature-verified, idempotent, replay-protected like the GitHub one) — a separate future approval when real ingestion is needed.

### D8 — Confirm the redaction-first data flow (privacy by design)
**Clause:** §5 "Redact before persist, before LLM, before state."

**Ask:** confirm the **mandatory flow** — a transcript passes the existing redaction/normalize node **before** it touches Aurora, S3, LangGraph state, or any Bedrock prompt; **fail closed** when redaction confidence is low (don't persist rather than risk leaking PII). No raw transcript is ever stored or sent to a model.

### D9 — Confirm erasure + retention extend to call data
**Clause:** §5 (erasure across Aurora **and** S3; retention TTL; no PII in logs/telemetry).

**Ask:** confirm the new call tables/S3 keys carry `release_run_id` + `retention_expires_at` so the **existing** `retention-sweep` and `erase` CLIs cover them automatically — a data-subject erasure of a run also erases its call data, and expired transcripts auto-delete.

### D10 — Inbound routing (recommend: DEFER)
**Clause:** §5 (commenter PII), §1/§7 (per-platform inbound webhooks).

**Ask:** **defer** to a later slice. It adds new inbound webhooks and a second PII inflow (commenters) for the smallest tagline payoff. If approved now, it must reuse the same redaction-before-persist + erasure rails.

---

## Required engineering gate (not just an approval) — privacy eval extension
**Clause:** §6 "the privacy eval suite passes with CRITICAL and HIGH gates at **zero** failures … redaction integrity, PII/PHI exposure."

Phase 5 is **not done** until the privacy eval suite is extended with call-transcript fixtures (synthetic, with planted PII/special-category data) proving the redaction node catches them, and that gate is green. This is the objective bar the work must clear before any deploy — independent of the operator approvals above.

> **DPIA note:** processing call recordings at production scale may trigger a **Data Protection Impact Assessment** (GDPR Art. 35). Not required for a synthetic-data hackathon demo, but flagged as a prerequisite before any real-customer rollout.

---

## What does NOT change
- Redaction, retention, erasure, and the privacy eval **spine is reused** — no parallel PII path is created.
- Bedrock + Guardrails remain the only model/safety path (§1); the three gates (§5) are untouched.
- No PII reaches the React client or any log/telemetry (§5).
- Calls are evidence *inputs*; nothing about calls publishes without passing Gate #1/#2.

---

## Blast radius & rollback
- **Default-off & opt-in:** no call ingestion exists until enabled; the recommended path takes manual uploads only.
- **Synthetic-first:** the demo uses fixture transcripts — zero real customer PII.
- **Reversible:** disable the upload surface; erase ingested call rows via the existing `erase` CLI (Aurora + S3).

---

## Operator decision checklist

- [ ] **D6** — Customer-call transcripts approved as an evidence category; lawful basis + purpose limitation recorded; data minimization (redacted snippets only); only lawfully-recorded calls fed in.
- [ ] **D7** — Ingestion path: **manual upload (recommended)** / call-tool webhook (specify). Synthetic data for the hackathon.
- [ ] **D8** — Redaction-first flow confirmed; fail-closed on low redaction confidence; no raw transcript persisted or sent to a model.
- [ ] **D9** — Erasure + retention confirmed to extend to call data (release_run_id + retention_expires_at; existing sweeps cover it).
- [ ] **D10** — Inbound routing: **deferred (recommended)** / approve now (reusing the same rails).
- [ ] **Ack** — Phase 5 ships only after the privacy eval suite (CRITICAL/HIGH at zero) is extended for call-transcript redaction and is green.

**Decision / signature:** ______________________  **Date:** __________

> Engineering will not begin Phase 5 ingestion until D6–D9 are approved. D10 may be deferred. The privacy-eval extension is a hard release gate regardless of the approvals.
