# Approved-artifact export and outbound distribution webhook

> PRD anchors: 8.2 (autopublished_assets deferred — this spec stays strictly human-gated; export happens only AFTER Gate #2 approval, so the §1.2 "full autopublishing without human approval" non-goal is not touched); 14.3 artifact APIs; 18.1 publishable truth = approved snapshots; 18.3 audit trail; Phase 5 "audit export"
>
> Operator-approved constitutional touchpoints: (1) outbound webhook target is a new network-egress destination — add to the harness egress allowlist; (2) one new secret pair (`OUTBOUND_WEBHOOK_URL` / `OUTBOUND_WEBHOOK_SECRET`). No repo writes; §5 blast radius otherwise unchanged.

## Summary

Approved artifacts currently dead-end in Aurora: Gate #2 resolves, the immutable snapshot is recorded, and nothing can leave the system except by manual copy-paste from the dashboard. This spec adds the last mile while keeping every gate intact: (a) export of approved artifacts via API and dashboard (markdown/HTML/JSON with claim-level provenance), and (b) a signed, idempotent outbound webhook fired on artifact approval so downstream tools (CMS, Zapier, internal bots) can consume content. Source of truth for all exports is the `approved_artifact_snapshots` table (§18.1 publishable truth), never the mutable draft row. Drafts, blocked, edited, and rejected artifacts are not exportable.

## Acceptance criteria

- `GET /api/artifacts/{artifactId}/export?format=markdown|html|json` returns the **approved snapshot** content; JSON format includes provenance (content hash, claim list with support status, evidence ids, model/prompt/skill versions, reviewer decision id). Non-approved artifacts return 409 with a user-safe error.
- `GET /api/releases/{releaseRunId}/artifacts/export` returns a bundle (zip or multi-doc JSON) of all approved artifacts for the run, same snapshot-only rule.
- Dashboard: approved artifacts on `/releases/[id]/artifacts/review` and the claim inspector gain "Copy markdown" and "Download" actions; keyboard-operable, WCAG 2.2 AA, no new client-side secrets.
- On each artifact approval (and run-level approve-all), an outbound webhook POSTs a metadata + content payload to the configured endpoint: HMAC-SHA256 signature over the **raw body** in a header, delivery id, timestamp. Endpoint URL + secret come from server-side env only.
- Webhook delivery is idempotent and audited: a new `outbound_webhook_deliveries` table records delivery id, target, artifact/run ids, attempt count, response status, and timestamps; retries use exponential backoff with a bounded attempt cap; redelivery reuses the same delivery id so consumers can dedupe.
- Webhook payloads contain only post-redaction, post-Guardrails approved content (which is already the only thing that can pass Gate #2); no evidence excerpts, and reviewer identity is excluded from the outbound payload.
- Feature is fully off when `OUTBOUND_WEBHOOK_URL` is unset; export endpoints work regardless.
- Tests: export-of-nonapproved rejection, snapshot-vs-draft divergence (edited-after-approval artifact exports the approved snapshot), signature verification round-trip, retry/idempotency, e2e for the dashboard export flow.
