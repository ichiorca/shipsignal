# ShipSignal — UI/UX & Marketing Recommendations

> Author: staff-level UX + marketing review (2026-06-27).
> Scope: information architecture, the core approval loop, the value/trust story, demo
> time-to-wow, and visual polish. Grounded in the actual IA (`app/lib/sidebarNav.ts`),
> shell (`app/layout.tsx`), and core surfaces (Founder Dashboard, Approval Queue, Drafting,
> `HeroStats`).

## The core diagnosis

**One user, one loop, twelve nav items.** ShipSignal's job is singular — *turn a release into
approved, evidence-backed marketing content* — but the sidebar carries 12 destinations across 3
sections that were copied from a peer app (`hindsight-guild`) "so the two can merge," with names
kept identical *even where ShipSignal has no equivalent* (Agents, Experiments are "coming
soon"/empty). That is the biggest UX tax: navigation that promises features that don't exist, and
a structure organized around a *different* product's mental model.

The moat — *claim-level provenance, never generated from raw diffs, human-gated* — is currently
expressed as **one stat in a strip**. For a product whose entire pitch is *trust*, the trust
story is under-sold.

---

## Recommendations

### R1 — Restructure the IA around the funnel *(P1, biggest lever)*

The product is a pipeline: **Create → Review → Distribute → Learn.** Make the nav *be* the
pipeline. Collapse 12 → ~7 items grouped by the verb the user is doing.

```
PROPOSED (workflow funnel)
▸ OVERVIEW
    Dashboard         ROI + what needs you
▸ WORKFLOW
    New Launch        start a release → content
    Review Queue      gates waiting on you ●3
    Published         what shipped + where
▸ INTELLIGENCE
    Self-Learning     how the system improves
    Quality & Cost    rubric, drift, spend
▸ LIBRARY
    Skills            playbook versions
    Capabilities      agent → skill mapping
▸ Admin (footer)      settings, projects, webhooks
```

- Merge the observability surfaces (`Live Ops`, `Quality Signals`, cost) into one "Quality &
  Cost" glance.
- Decouple from the peer-app naming where it forces parity at the cost of clarity (the merge is a
  future concern; the polish cost is today).

### R2 — Hide stubbed nav items *(P0)*

> **Correction during implementation:** `Agents` was found to be **already functional** — a real
> capability editor backed by Aurora + migration 0035 — so it stays in the nav. Only
> `Experiments` is genuinely unbuilt (an honest empty state with no data model), so only it is
> removed.

A "coming soon" destination in the nav reads as an unfinished product to a customer or a hackathon
judge. Remove the stubbed `Experiments` entry from the nav (keep the route; just drop the nav
entry). Re-add when backed by data.

### R3 — Live count badges on nav *(P1)*

Show "Review Queue ●3" (count of gates awaiting a decision). Turns the nav into an action driver —
the most effective conversion nudge in an internal tool.

### R4 — De-duplicate Dashboard vs Approval Queue *(P1)*

Both currently lead with `ReviewQueue` + `RunFeed`. Differentiate:
- **Dashboard** = the *narrative* (ROI hero + the single most urgent thing needing you + a primary
  CTA). Lighter, story-first.
- **Approval Queue** = the *dense work inbox* (all gates + full launches feed, filter/search).

### R5 — Sell the differentiator visually *(P1)*

- Promote provenance from a stat to a hero motif: everywhere a claim appears, show it tethered to
  its evidence inline (claim → ✓ commit a1b2c3, ✓ PR #42). That visual is both the trust UX and
  the best marketing screenshot.
- Add a one-line hero headline above `HeroStats`: *"From a git tag to publish-ready content in
  minutes — every claim traceable to the diff that earned it."* The numbers then *prove* the
  claim instead of standing alone.

### R6 — Reframe cost as the money story *(P2)*

"$0.18 model cost per release · vs ~4h of PMM time" is the purchase justification. Make the
time/headcount-saved framing explicit and prominent (largest tile), not a buried detail.

### R7 — Editorial typography for artifact bodies *(P2)*

Inter (UI), **Source Serif 4 (artifact bodies)**, JetBrains Mono (diffs/SHAs/evidence). All three
are already loaded; render generated content in the serif so marketing copy *looks like finished
collateral*, not form data.

### R8 — Optimize the decision surface *(P2)*

- One artifact, one screen, one primary action; claims+evidence collapsible beneath.
- Batch flow: "Artifact 2 of 5", auto-advance after a decision.
- Keyboard shortcuts (A approve / R reject / E edit / → next).
- Reviewer name set once per session, never re-asked (already via `useReviewerName`).

### R9 — Time-to-wow for the demo *(P0)*

- Make **"Load a sample release"** the empty-state hero CTA (it seeds a fully-populated run with
  no GitHub token), landing the user directly in generated content awaiting approval.
- Engineer the 3-click judge path: Load sample → Review Queue → Approve → "Published".
- Add a thin "demo mode / synthetic data" indicator so judges always know the data is seeded —
  reinforcing the honesty already built in (`—` placeholders instead of fabricated numbers).

### R10 — Funnel view for the marketer *(P2)*

A single funnel: Drafts → Approved → Published → Engagement (UTM/ROI loop already exists). Closes
the loop from "we made content" to "it drove results" — the slide every marketer wants.

---

## Prioritized roadmap

| # | Priority | Change | Effort |
|---|---|---|---|
| R9 | **P0 (demo)** | Empty-state → "Load sample" hero; 3-click approve→publish path | S |
| R2 | **P0** | Hide `Agents`/`Experiments` "coming soon" from nav | XS |
| R1 | **P1** | Collapse nav 12→7 around the funnel | M |
| R3 | **P1** | Live count badges on nav | S |
| R4 | **P1** | De-duplicate Dashboard vs Queue | S |
| R5 | **P1** | Inline claim→evidence + hero headline | M |
| R7 | **P2** | Serif artifact bodies | S |
| R6 | **P2** | Cost-as-money-saved tile | S |
| R8 | **P2** | Batch review flow + keyboard shortcuts | M |
| R10 | **P2** | Funnel view (drafts→published→engagement) | M |

## Implementation log

Tracked as the work proceeds. Each row links the recommendation to the files changed and the
verification run.

| # | Status | Files | Verified |
|---|---|---|---|
| R2 | ✅ done | `app/lib/sidebarNav.ts` | tsc + 440 TS tests |
| R9 | ✅ done | `FirstRunHero.ts`, `SampleDataNotice.ts`, `syntheticRun.ts`, `app/page.tsx`, `globals.css` + 2 tests | tsc + new tests pass |
| R1 | ✅ done | `app/lib/sidebarNav.ts` + 11 page eyebrows (Overview/Workflow/Intelligence/Library/Admin) | tsc + 471 TS tests |
| R3 | ✅ done | `Sidebar.ts`, `layout.tsx`, `releaseRuns.ts` (`countRunsAwaitingReview`), `runProgress.ts` (`AWAITING_REVIEW_STATUSES`), `globals.css` + drift test | tsc + 472 TS tests |
| R4 | ✅ done | `app/page.tsx` (narrative + CTAs, feed removed), `app/queue/page.tsx` (full feed + notice), `globals.css` | tsc + 472 TS tests |
| R5 | ✅ done | `app/page.tsx` (hero lede), `artifactApproval.ts` (`provenanceSummary`), `ArtifactReview.ts`, `globals.css` + tests | tsc + a11y tests |
| R7 | ✅ done | `ArtifactDraftList.ts`, `globals.css` (`[data-artifact-body]` serif) | tsc + a11y tests |
| R6 | ✅ done | `heroStats.ts` (`buildSavingsStat`, `PMM_BASELINE_HOURLY_USD`) + tests | tsc + 476 TS tests |
| R8 | ✅ done | `ArtifactReview.ts` (keyboard triage + progress + decided marker), `globals.css` + 2 tests | tsc + a11y tests |
| R10 | ✅ done | `funnel.ts`, `db/funnelStats.ts`, `ConversionFunnel.ts`, `app/page.tsx`, `globals.css` + 2 tests | tsc + 485 TS tests |

All ten recommendations implemented and verified (485 TS tests, 414 worker tests, ruff + tsc clean).
The deferred operator-auth item (security review #6) remains out of scope per the hackathon decision.
