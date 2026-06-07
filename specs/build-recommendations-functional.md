# Internal "Memoir-style" Release-to-Content Engine — Build Recommendations

Date: 2026-06-03 (rev. 4) · For: Rohit · Scope: all four output types, triggered on git tags · **Now targeting the [H0 hackathon](https://h01.devpost.com/) (deadline Jun 29, 2026) — see §8 for required tech (Vercel v0 frontend + Aurora PostgreSQL) which supersedes parts of §2/§5/§7**

> **Note on the team PDF:** its competitor table misidentifies Memoir — it analyzed memoir.sh (a semantic memory system for AI agents), not trymemoir.ai (YC P26 AI Growth Engineer). Its conclusion that "no competitor does code-grounded content generation" is therefore overstated; trymemoir.ai does exactly that. For an internal tool this doesn't change the plan, but discount that section. The PDF's research on diff-summarization (ReleaseEval, SmartNote), AST tooling, evaluation, and governance is solid and is incorporated below.

---

## 1. What Memoir actually does (research summary)

[Memoir (YC P26)](https://www.trymemoir.ai/) is an "AI Growth Engineer" with four stages:

1. **Reads** — watches repo, releases, and customer calls.
2. **Writes** — blog, LinkedIn, HN, X posts in the founder's learned voice.
3. **Records** — an AI agent drives their *live staging app* with **synthetic data** (so dashboards look real), records it, and narrates with a cloned voice.
4. **Publishes** — human-approved, scheduled for audience timing, with a viral-trend matcher that ties product features to trending threads.

Key takeaways for your build:

- The repo diff is only the *trigger signal*. The quality comes from combining it with PR descriptions, issue/ticket context, and product knowledge — raw diffs alone produce engineer-speak, not marketing copy.
- The demo video pipeline is the hard, differentiated part. Their trick: dedicated staging env + seeded synthetic data + a browser agent that performs the feature on camera.
- Everything is human-in-the-loop ("100% founder-approved"). Don't aim for full autopublish.
- Voice/style learning is iterative — they feed approvals/edits back into the system weekly.

---

## 2. Recommended architecture (Agent SDK pipeline on GitHub)

```
GitHub Release (tag push)
        │  webhook / Actions trigger
        ▼
┌─────────────────────────────────────────────┐
│ Stage 1: EVIDENCE BUILDER (Claude Agent SDK)│
│ • git diff prev-tag..tag (compare API)      │
│ • Merged PRs in range: titles, bodies,      │
│   labels, linked issues/Jira via gh CLI     │
│ • Syntax-aware signals (Tree-sitter /       │
│   Difftastic): changed public APIs, new     │
│   routes, UI strings, feature flags, schema │
│   changes, permission gates, new tests      │
│ • Weak labels: existing CHANGELOG entries,  │
│   docs diffs, launch notes                  │
│ • Secret-scan + redact BEFORE model sees it │
│ • Classify & cluster → candidate features   │
│ • Output: feature-manifest.json — each      │
│   feature carries: summary, user_value,     │
│   audience, change_type, confidence,        │
│   evidence_ids (provenance), demo steps     │
└─────────────────────────────────────────────┘
        ▼
   ── HUMAN GATE #1: approve/edit feature ──
   ── objects before any content is made  ──
        ▼
┌─────────────────────────────────────────────┐
│ Stage 2: CONTENT GENERATORS (parallel       │
│ subagents, one per artifact type)           │
│ • Blog/changelog post  (md → CMS draft)     │
│ • Sales collateral     (one-pager, deck,    │
│   battlecard updates)                       │
│ • Demo video script + click-path JSON       │
│ • Training video script + chapters          │
│ Each reads: manifest + brand-voice file +   │
│ product-context file + past approved content│
└─────────────────────────────────────────────┘
        ▼
┌─────────────────────────────────────────────┐
│ Stage 3: VIDEO PIPELINE                     │
│ • Spin staging env, seed synthetic data     │
│ • Browser agent (Playwright + computer-use) │
│   executes click-path, records screen       │
│ • TTS narration (ElevenLabs) over script    │
│ • Assemble with ffmpeg / Remotion           │
└─────────────────────────────────────────────┘
        ▼
┌─────────────────────────────────────────────┐
│ Stage 4: REVIEW & PUBLISH                   │
│ • All artifacts land as a PR in a           │
│   content repo (or Notion/Slack review)     │
│ • Human approves/edits → merge = publish    │
│ • Edits feed back into voice/style files    │
└─────────────────────────────────────────────┘
```

### Why this shape

- **GitHub Actions as the runtime** means zero standing infra: a `release: published` trigger runs the whole pipeline in CI. The Claude Agent SDK (or `claude` CLI in headless mode) runs inside the action with repo access already in place.
- **Structured evidence beats raw diffs — now research-backed.** The team PDF cites ReleaseEval (LLMs still struggle on raw diff→summary while doing much better on structured input) and SmartNote (aggregating code + commit + PR detail with significance scoring beats diff-only prompting). This is why Stage 1 invests in syntax-aware signals and metadata fusion rather than dumping diffs into a prompt.
- **Manifest as the contract, evidence as provenance.** One `feature-manifest.json` per release decouples analysis from generation. Every claim in every downstream asset must cite `evidence_ids` that trace back to specific PRs/commits/issues — this makes outputs auditable and lets reviewers verify claims instead of trusting them.
- **Two human gates, not one.** Gate #1: approve/edit feature objects *before* generation (cheap to correct a wrong feature understanding; expensive to correct four artifacts built on it). Gate #2: approve rendered assets per channel before publish.
- **Content-repo-as-review-queue.** Generated drafts arrive as a PR; your existing code-review muscle becomes the approval workflow. The PDF proposes a custom reviewer UI with side-by-side claim/evidence views — right idea, but for an internal v1 a PR template that lists each claim with its evidence links gets 90% of the value at 5% of the cost. Build the UI only if reviewer friction proves it out.
- **Two-tier model routing.** Cheap fast model (Haiku-class) for extraction, classification, JSON outputs, and validators; strong model (Sonnet/Opus-class) only for ambiguous feature inference and final customer-facing copy. The PDF's cost math confirms a full release-intelligence pass is cents-to-dollars — the routing discipline matters more at video/orchestration scale than for text.

---

## 3. Build order (phased)

### Phase 1 — Diff → blog/changelog (1–2 weeks)
The 80/20. GitHub Action on release tag → agent diffs tags, reads PRs in range, writes the manifest + a blog post and changelog entry → opens PR in content repo. Comparable to [GitHub's copilot-release-notes](https://github.com/github/copilot-release-notes) but with marketing framing, brand voice, and the manifest layer.

Critical inputs to create up front (these determine output quality more than any model choice) — **author these as versioned skills, not loose files** (see §7, adopted from hindsight-guild):
- `skills/brand-voice/SKILL.md` — tone, vocabulary, banned phrases, 3–5 examples of approved past content
- `skills/product-context/SKILL.md` — what the product does, who uses it, key personas, competitor positioning
- `skills/audience-map/SKILL.md` — which feature types map to which content type/channel
- **Gold evaluation set** (from PDF — do this in week 1): hand-label one past release — which changes were marketable features, what the ideal blog post said. This is your regression test for every prompt/model change later. If you have past release notes or launch emails, treat them as "gold-ish" supervision.

Skip the AST tooling (Tree-sitter/Difftastic/GumTree) in Phase 1 — PR metadata + plain diffs are enough to validate the loop. Add syntax-aware extraction in Phase 1.5 *if* eval shows the model missing features or hallucinating impact; the highest-value structural signals to add first are feature-flag names, new API routes, UI string changes, and schema migrations, since those are near-deterministic markers of user-facing change.

### Phase 2 — Sales collateral (1 week on top)
Same manifest, additional subagents: feature one-pager (use the docx/pptx generation path), battlecard delta ("what to tell prospects who asked about X"), demo talk-track for AEs. Mostly prompt + template work.

### Phase 3 — Demo videos (the hard part, 3–6 weeks)
1. Stage 2 already emits a **click-path JSON** (URL, steps, selectors, narration beats) per feature.
2. Dedicated **demo staging environment** with a synthetic-data seed script — this is the single biggest investment and the thing Memoir gets right. Realistic-looking data is what separates "AI demo" from "real demo."
3. Playwright executes the click-path and records video; where selectors are brittle, fall back to a computer-use agent that finds elements visually.
4. ElevenLabs TTS over the narration script (existing subscription — see §6); ffmpeg/Remotion to assemble, add intro/outro branding.
5. Expect to iterate: deterministic click-paths fail on UI changes, so build a "agent verifies the path in a dry run, flags failures for human fix" step.

Buy-vs-build note: [Clueso](https://www.ycombinator.com/launches/Ovz-clueso-product-videos-in-minutes-with-ai), Arcade, and [Saltfish](https://saltfish.ai/blog/arcade-alternatives) (which does synthetic-data sandboxes) cover the "screen recording → polished video" half. A pragmatic hybrid: your agent drives the staging app and records raw footage, a tool like Clueso polishes it. Pure build gives you full automation; hybrid ships weeks earlier.

### Phase 4 — Training videos (after Phase 3)
Reuses the entire video pipeline; differences are script shape (longer, chaptered, exercise-oriented) and source material (docs + manifest history, not just one release). Cheapest if you treat it as "demo video pipeline with a different script generator."

### Phase 5 — Skills self-learning & evolution (adopted from hindsight-guild — see §7)
Replaces the naive "weekly job updates brand-voice.md" idea with the proven closed loop from your hindsight-guild app: capture review-PR edit diffs and rejections as structured feedback → nightly deterministic miners cluster recurring patterns → miners propose skill revisions as PRs against the skills directory → you approve = skill promoted; every artifact stamps which skill versions produced it. This is Memoir's "voice match improves weekly" mechanic, implemented the way hindsight-guild already does it.

---

## 4. Key design decisions & gotchas

- **Don't generate from raw diffs.** Diffs tell you *what* changed; PR descriptions and linked issues tell you *why*. Pull both. If your team writes thin PR descriptions, fix that first — it's the cheapest quality lever in the whole system.
- **Classification gate matters.** Most commits are not marketable. A strict "user-facing? meaningful? demo-able?" filter in Stage 1 prevents content spam and keeps reviewer trust.
- **Human approval is the product.** Internal tool ≠ low stakes; bad sales collateral misinforms your own AEs. Keep merge-to-publish.
- **Secrets/IP hygiene.** The agent sees your codebase; generated content must never leak internal names, unreleased features, security details. Two layers (per PDF): (1) secret-scan/redact evidence *before* it reaches the model, (2) a redaction-check subagent on outputs before the review PR — flag internal code names, customer names, internal URLs, unverifiable performance claims. Maintain an explicit separation between "internal technical truth" and "externally publishable facts."
- **Cost control.** Run per-release (not per-PR), cache the manifest, and use a cheaper model for classification with a stronger model only for final copy. PDF cost anchors: a 100k-in/10k-out pass costs well under $1 on mid-tier models; the real costs are video rendering, GPU residency, and reviewer time — not text tokens.
- **Measure the system (from PDF — absorb fully).** Track from day one: *evidence coverage* (% of generated claims with a valid evidence pointer), *unsupported-claim rate* (claims reviewers reject as ungrounded), *edit distance* between draft and final approved version, and *approval latency*. These four tell you whether the system is improving and where to invest next. Don't use BLEU/ROUGE-style metrics; use reviewer judgments and an LLM-as-judge pass against your gold set.
- **Audit trail.** Log evidence bundle + prompt/template version + model version for every generated asset. Near-free to do (commit them alongside drafts in the content repo) and makes every output reproducible and explainable.
- **Voice cloning (Memoir narrates in a cloned founder voice):** for internal use, a good stock ElevenLabs voice avoids consent/deepfake policy questions entirely. Add cloning later only with explicit consent.

---

## 5. Concrete stack

| Layer | Choice | Notes |
|---|---|---|
| Trigger | GitHub Actions on `release: published` | |
| Analysis & generation | Claude Agent SDK (headless), subagents per artifact | Two-tier routing: Haiku-class for extraction/classification/validators, Sonnet/Opus-class for feature inference + final copy |
| Repo context | `gh` CLI: diff, PR list, linked issues (+ Jira via API if tickets live there) | |
| Structural signals (Phase 1.5) | Tree-sitter / Difftastic | Feature flags, routes, UI strings, schema changes — add when eval shows the need |
| Evidence hygiene | Secret scanning (gitleaks/trufflehog) pre-ingestion; redaction subagent on outputs | |
| Review | ~~PR into a `content` repo~~ → **v0-built Next.js Review Dashboard on Vercel** (§8): claim↔evidence view, two approval gates, skills admin | Hackathon requirement turned this into the product's face |
| Database | **Aurora PostgreSQL Serverless v2 + pgvector** (§8): releases, evidence, feature clusters, artifacts, approvals, skills/versions, telemetry, lessons | H0-required; replaces git-as-database |
| Evaluation | Gold set from past releases; LLM-as-judge rubrics (brand_voice, claim_support, claim_risk, audience_relevance, originality, conversion_intent — set from hindsight-guild) + reviewer metrics (evidence coverage, unsupported-claim rate, edit distance, approval latency) | |
| Skills layer | `skills/` dir of SKILL.md files in content repo; `read_skill` tool + per-agent allowlists; usage logged in provenance | Ported from hindsight-guild (§7); git = registry + version history |
| Learning loop | Weekly miner Action: cluster review-PR edit diffs + rejections → skill-revision PRs with evidence; `lessons/` scoped memory | Evolvable skills only; merge = promotion, revert = rollback |
| Video capture | Playwright recording against seeded staging env | PDF independently confirms deterministic capture > text-to-video for software demos |
| Narration & audio | ElevenLabs (existing subscription) | TTS for narration; see §6 for full usage map across the pipeline. Synthesia avatar layer optional, later, presenter-style only |
| Assembly | Remotion (programmatic, brandable) or ffmpeg | |
| Collateral | docx/pptx generation from templates | |
| Storage | Content repo for text + evidence bundles + prompt versions; S3/Drive for video | Doubles as the audit trail |

Estimated effort: Phase 1–2 in ~2–3 weeks for one engineer; Phase 3 is where most of the calendar time goes. Budget (per PDF pilot band, adjusted for single-product internal use): expect the low end of $3k–12k/month in API + tooling spend, dominated by video once Phase 3 lands — text generation is rounding error.

---

## 6. ElevenLabs as the audio/multimodal backbone (existing subscription)

You already pay for ElevenLabs, so it becomes the default for every audio surface in the pipeline — this removes the TTS-vendor decision and unlocks a few extra artifact types nearly for free:

| Pipeline point | ElevenLabs capability | Use |
|---|---|---|
| Demo video narration (Phase 3) | TTS — `eleven_multilingual_v2` for long-form quality | Narrate the click-path script; consistent named voice across all videos = brand recognition |
| Training videos (Phase 4) | TTS long-form + chapters | Same voice, chaptered narration; regenerate single chapters when a feature changes instead of re-recording |
| Release audio digest (new, cheap win) | TTS | 2-min "what shipped this release" audio for internal Slack/standup — just the changelog through TTS, near-zero marginal effort |
| Localized content (later) | Dubbing v2 (90+ languages, preserves voice) | If sales/training content needs other languages, dub the master video instead of re-rendering per language |
| Intro/outro + background (polish) | Music + SFX generation | Branded sting and subtle bed for demo videos, generated once, reused via Remotion template |
| Script QA (optional) | Scribe STT | Transcribe rendered video back to text and diff against the approved script — catches assembly/timing errors automatically |
| Voice cloning | Available, but opt-in only | Stock or designed voice is the right internal default; clone a real person's voice only with written consent |

Build note: drive everything through the ElevenLabs API from the GitHub Action (Stage 3), not the web studio — narration must be reproducible from script + voice-ID + model version, same provenance rule as text. Watch credit consumption: video narration at scale is the main draw on the subscription, so log characters-used per release alongside token costs.

---

## 7. Skills curation, self-learning & evolution (adopted from hindsight-guild)

Your hindsight-guild GTM app already solved the learning layer this product needs. The practices below port directly, adapted from its Mongo/Cloud Run architecture to this product's git-native GitHub Actions architecture.

### 7.1 Skills as the knowledge substrate (curation)

All product/brand/format knowledge lives as **SKILL.md files** (Agent Skills standard, same format hindsight-guild uses) in a `skills/` directory of the content repo:

```
skills/
  brand-voice/SKILL.md          # evolvable
  product-context/SKILL.md      # evolvable
  audience-map/SKILL.md
  blog-format/SKILL.md          # evolvable
  sales-onepager-format/SKILL.md
  demo-script-format/SKILL.md   # evolvable
  training-video-format/SKILL.md
  redaction-rules/SKILL.md      # evolvable
    references/banned-terms.md  # tier-3 deep dive
```

Port hindsight-guild's three mechanics exactly:

- **Three-tier progressive disclosure.** Tier 1: only name + description + version injected into each subagent's prompt (~80 tokens/skill). Tier 2: full body loaded via a `read_skill(name)` tool when needed. Tier 3: `references/*.md` for deep dives. Keeps context lean as the skill library grows.
- **Per-agent allowlists + required skills.** Each Stage-2 generator gets only its relevant skills, with some mandatory (e.g., blog generator *must* read `brand-voice` + `blog-format` before writing; redaction subagent must read `redaction-rules`). hindsight-guild's `SKILLS_BY_AGENT` / `REQUIRED_SKILLS_BY_AGENT` pattern, enforced at the tool level.
- **Skill-usage telemetry.** Log every tier-2/3 load (skill, version, agent, artifact ID) into the artifact's provenance record. This is what makes evolution attributable: when a draft gets heavy edits, you know exactly which skill versions produced it.

### 7.2 Self-learning loop

hindsight-guild's feedback capture, mapped to this product's PR-based review:

| hindsight-guild | This product |
|---|---|
| `approvals` collection (approve/edit/reject + rejection_category) | Review-PR outcomes: merged-clean / merged-with-edits (git diff = the edit) / closed (rejection, with a labeled reason: tone, claim_risk, accuracy, audience) |
| Token-level diff of original vs founder-approved text | `git diff` between generated commit and merged result — free, already structured |
| 6 LLM rubric scores (brand_voice, claim_support, claim_risk, icp_relevance, originality, conversion_intent) | Same rubric set, scored by an LLM-judge pass against the gold set (folds into §"Measure the system" metrics) |
| `agent_lessons` memory with scoped `remember_lesson()` / `recall()` | A `lessons/` directory in the content repo, scoped per channel/audience (e.g., `lessons/sales-collateral.md`); generators recall top-N relevant lessons before drafting |

**Miners (the key import).** hindsight-guild's nightly miners are *deterministic clustering jobs, not LLM agents* — this is the right call and worth copying:
- **Voice miner**: cluster recurring n-gram removals/additions across edit diffs (threshold: pattern appears ≥3 times across ≥3 artifacts) → proposes bullets for `brand-voice` ("never say X") .
- **Negative miner**: cluster rejection reasons → adds negative examples + rule tightening to the relevant format skill.
- Run weekly (not nightly — internal release cadence is lower than hindsight-guild's daily content volume), as a scheduled GitHub Action.

### 7.3 Skills evolution (proposal → gate → promotion)

hindsight-guild's candidate/promotion machinery, simplified for git:

1. **Evolvable set is explicit.** Only enroll skills where feedback signal is rich: `brand-voice`, `product-context`, `blog-format`, `demo-script-format`, `redaction-rules`. Others change only by hand. (Mirrors `EVOLVABLE_SKILL_IDS`.)
2. **Proposals are PRs.** Miners (and optionally a weekly self-critique agent that reads telemetry + rubric trends) open a PR against `skills/` with: the revised SKILL.md (version bumped in frontmatter), and a PR body stating *issue, evidence count, links to the artifacts/edits that motivated it, confidence* — hindsight-guild's `self_critique_proposal` schema, expressed as a PR description.
3. **Human gate = PR review.** Merge = promotion; the git history *is* hindsight-guild's `versions` + `history` structure, for free. No Mongo needed at internal scale.
4. **Promotion gate, relaxed.** hindsight-guild gates on ≥50 actions + 5pp lift + Z-test — right for its volume, unreachable at internal release cadence. Substitute: a proposal must cite ≥3 supporting edit-instances, and post-merge, watch edit-distance trend on the next 3 releases; if it worsens, `git revert` is the rollback.
5. **Cooldown on dismissed proposals.** If you close a miner PR, it must not re-propose the same pattern for 14 days (track in a small state file).

### 7.4 What this changes in the build order

- Phase 1 now includes: skills directory + `read_skill` tooling + allowlists + usage logging in provenance (small effort, structural payoff).
- Phase 5 = miners + proposal PRs + lessons memory. Build after 3–4 releases of accumulated edit data — miners need material to mine.
- The stack stays serverless: skill registry = the git repo itself; reconciliation machinery hindsight-guild needs for multi-container Mongo sync disappears because GitHub Actions checks out fresh state every run. Graduate to a DB-backed registry only if this product later serves long-running agents.

---

## 8. Hackathon build — H0 required tech (supersedes parts of §2/§5/§7)

Target: [H0: Hack the Zero Stack](https://h01.devpost.com/) (Vercel v0 + AWS Databases, $80k, deadline **Jun 29, 2026 5pm PDT**).

### Hard requirements → architecture changes

| H0 requirement | What changes in this plan |
|---|---|
| Full-stack app; frontend scaffolded with **v0** and deployed on **Vercel** | The PR-based review queue (§2) is replaced by a **v0-built Next.js Review Dashboard** — this is now justified where it wasn't for a pure internal tool. It becomes the product's face: release feed, feature-manifest approval (Gate #1), artifact review with side-by-side claim↔evidence view (Gate #2), skills admin with version diffs + promotion buttons, provenance explorer. The PDF's reviewer-UI recommendation and hindsight-guild's web_api/skills-admin UI now both apply directly. |
| One of **Aurora PostgreSQL / Aurora DSQL / DynamoDB** | Git-as-database (§7.4) is superseded: operational data moves to **Aurora PostgreSQL Serverless v2** (recommended — see below). Skill bodies, versions, evidence bundles, artifacts, approvals, telemetry all become tables. Git remains only the trigger source (the codebase being analyzed). |
| Judges score "deliberate data model" | Design the schema as a first-class deliverable: `releases`, `evidence_items`, `feature_clusters` (with confidence + evidence FK — provenance as foreign keys), `artifacts` (skill_versions_used jsonb), `approvals` (decision, edit_diff, rejection_category), `skills` / `skill_versions` (candidate→promoted lifecycle), `skill_usage`, `lessons`. This is hindsight-guild's Mongo schema, normalized into relational form — a genuinely good story for judges. Add **pgvector** for semantic search over evidence and lessons (recall step in §7.2) — a deliberate reason to pick Aurora PostgreSQL over DynamoDB. |
| Architecture diagram + storage-config screenshots + Vercel project link | Produce the diagram from §2's pipeline + the new dashboard/Aurora layers; capture storage config early so it's not a scramble at submission. |

**Database choice:** Aurora PostgreSQL Serverless v2. Relational fits the provenance graph (claims→evidence→releases are joins, not lookups), pgvector covers semantic recall, and scale-to-near-zero keeps hackathon cost low. Aurora DSQL is the runner-up (serverless-est story) but lacks extensions like pgvector; DynamoDB would force awkward modeling of the many-to-many evidence graph.

**Pipeline runtime stays GitHub Actions** (release-tag trigger → agents → write results to Aurora via RDS Data API/Postgres driver). Vercel hosts the dashboard + API routes for approvals, skill promotion, and artifact serving. This split is honest and demo-friendly: "engineering ships → pipeline populates Aurora → humans approve in the Vercel app."

### Track and judging fit

- **Track 2: Monetizable B2B app** — marketing/advertising is explicitly named in the track description, and "Memoir-style release-to-content engine" is an obviously monetizable B2B SaaS even if you run it internally first. (Track 4 Open Innovation is the fallback.)
- Judging criteria map: *Technological implementation* = the provenance data model + skills-evolution machinery; *Design* = the v0 review dashboard; *Impact* = real internal users + before/after content velocity; *Originality* = code-grounded content with evidence provenance + self-evolving skills — none of the changelog tools do this (§1).

### Hackathon-scoped cut (what to actually build by Jun 29)

1. **Week 1**: Aurora schema + Phase 1 pipeline (diff → evidence → manifest → blog draft into DB) + v0 dashboard scaffold (release feed, manifest approval).
2. **Week 2**: Artifact review UI with claim↔evidence view; sales one-pager generator; skills tables + read_skill from DB; ElevenLabs release audio digest (cheap, demos multimodal).
3. **Week 3**: One working demo-video path (Playwright capture of a single scripted flow + ElevenLabs narration + ffmpeg) — even one polished auto-generated video is the demo's wow moment. Voice-miner v0 (edit-diff clustering → skill-revision proposal surfaced in dashboard).
4. **Week 4**: Polish, seed realistic demo data, record the 3–5 min video, architecture diagram, screenshots, submit.

Defer to post-hackathon: training videos, dubbing/localization, AST extraction, statistical anything.

### Submission checklist

- [ ] Text description naming the AWS database used
- [ ] 3–5 min demo video (YouTube, public): problem, audience, working app footage, database explanation
- [ ] Published Vercel project link + Vercel Team ID
- [ ] Architecture diagram (frontend ↔ back-end connections)
- [ ] Screenshot: storage configuration proving AWS Database usage
- [ ] **Bonus points (meta-move):** the product's own Stage-2 blog generator writes the "how we built it" post → publish on builder.aws.com/dev.to with the required hackathon-entry disclosure and **#H0Hackathon**. The tool marketing itself is a memorable judge narrative.
- [ ] Before starting: sign up for v0, submit the [credits request form](https://forms.gle/FzLd8BLqzzrkuBMU7)

---

## 9. What was deliberately NOT absorbed from the team PDF

- **Custom reviewer UI** — deferred. PR-based review with an evidence-linked template covers an internal v1; build the UI only if reviewer friction demands it.
- **Full GumTree AST edit-action analysis** — overkill for v1; Tree-sitter/Difftastic signals in Phase 1.5 cover the high-value cases.
- **Self-hosted open-weight models (vLLM)** — only worth the ops burden under strict data-residency constraints or heavy steady load; hosted APIs with zero-data-retention terms are the right internal default.
- **Multi-provider model matrix** — the PDF's vendor comparison is useful reference, but standardizing on one provider with two tiers keeps the pipeline simple; revisit if cost or quality forces it.


