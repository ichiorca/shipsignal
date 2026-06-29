# Demo video script (target ≤ 2:45) — ShipSignal

**Live app:** https://shipsignal-xi.vercel.app/
**Primary run (fully real, agentic commerce):** https://shipsignal-xi.vercel.app/releases/3b1fed7f-eba1-487e-8382-0de8c26a33f3
Secondary (media-rich, offline-LLM): `/releases/49a31f1c-0cc7-4a56-a410-edefbffb0d2b` (hermes)

Record at 1280×720+, narrate the beats below, keep it tight. **Say "Amazon Aurora PostgreSQL" out
loud** (judging criterion) and **keep the live Vercel URL on screen**.

> **Click-path note (verified against the live site):** the home dashboard features a *seed* run
> (`acme/launchpad`) — **do not point at it.** Open the real agentic-commerce run by its URL
> (`/releases/3b1fed7f-…`) and drive every gate from the **links on that run page**: *Review feature
> manifest* (Gate #1) → *Review artifacts* (Gate #2) → *Demo media gallery* → *Skill revisions review*
> (Gate #3). `/skills` (“Skills Playbook”) and `/learning` (“Self-Learning”) are top-level.

**The moat, in one line (land it twice — beats 4 and 7):** the output is *provable* — an evidence→claim
provenance graph in Aurora behind *three human gates* — and the system *compounds*, mining reviewer
edits into versioned skills. A static generator can't copy trust, and can't catch a system that learns
from its own reviewers.

> Pacing: narration below is ~250 words (~1:50 spoken), leaving room for clicks inside 2:45. The lines are
> already trimmed — read them as written, don't ad-lib. If you still run long, cut the last sentence of beats
> **4** and **5**. Never cut beat **2** or the first line of **3**/**6**.

---

**Step 1 · 0:00–0:13 · The hook** — *home: `https://shipsignal-xi.vercel.app/`*
> "Every release, teams hand-write the blog, changelog, social posts and customer email — slow and
> untraceable. ShipSignal turns one GitHub release diff into approved, multi-channel content — authored
> on AWS, and provable down to the evidence."
- Show the dashboard overview (the content funnel + metrics). **Don't dwell on the `acme/launchpad`
  seed card** — you'll open the real run by URL in beat 3.

**Step 2 · 0:15–0:32 · The map (architecture)** — *`demo/ARCHITECTURE.md` flowchart, full screen*
> "Here's the system. A GitHub release diff flows into a LangGraph worker that collects, redacts,
> clusters, generates and learns. Every row of state lives in **Amazon Aurora PostgreSQL**; **Bedrock**
> authors and embeds; S3 holds media; Vercel is the only human surface."
- Trace with the cursor: GitHub → Worker → **Aurora** / Bedrock / S3 → Vercel.

**Step 3 · 0:32–1:00 · Gate #1 — the structural moat** — *`/releases/3b1fed7f-…` → "Review feature manifest" (`…/review`)*
> "This is our real agentic-commerce run — and here's the moat. We never generate copy from a raw diff.
> We ingest the diff, redact secrets and PII, and persist thousands of evidence rows to **Amazon Aurora
> PostgreSQL** — each embedded with Titan for pgvector search. Bedrock Nova then clusters that evidence
> into a feature manifest where every feature links to the concrete evidence it came from, and a human
> approves before a single word is written. That evidence-to-claim provenance graph, in Aurora, behind a
> human gate, is what makes the output trustworthy — and hard to copy."
- Show the features and their evidence links; open one **redacted excerpt**; show the approve gate.

**Step 4 · 1:00–1:24 · Gate #2 — provenance made concrete** — *run page → "Review artifacts" (`…/artifacts/review`)*
> "Only after approval does Bedrock write the content — blog, changelog, LinkedIn, customer email —
> grounded in the approved features, screened by Bedrock Guardrails, and approved by a second human.
> Open any artifact: every claim traces back to its evidence."
- Open the release blog (real Nova prose about Medusa/Spree); open its **provenance** panel
  (`/artifacts/{id}/provenance`).

**Step 5 · 1:24–1:42 · The payoff — narrated media** — *run page → "Demo media gallery" (`…/media`)*
> "Then a narrated audio digest and video — real ElevenLabs text-to-speech, assembled with ffmpeg,
> stored in Amazon S3 and served through presigned URLs. Approved media publishes to YouTube in one
> click."
- **Play ~4s of the MP3** and show the MP4; point to "Publish to YouTube".

**Step 6 · 1:42–2:00 · Gate #3 — the compounding moat** — *`/skills` (Skills Playbook) → `/learning` (Self-Learning)*
> "And it compounds. Reviewer edits are mined into a next-version skill, gated by a third human, then
> written back with its commit SHA. Here brand-voice was promoted to v1.1.0 — live. A static generator
> can't learn from its own reviewers."
- Show brand-voice **v1.1.0** on `/skills`; glance at the trend on `/learning`. (Keep it light.)

**Step 7 · 2:00–2:20 · Admin + close** — *`/admin` (agent capabilities + skills), then the live URL*
> "One admin module ties it together — the agents and the capabilities each one owns, plus the skills
> playbook, all operator-editable. Governed, on-brand, self-improving release content — diff to approved
> copy — on Amazon Aurora PostgreSQL, Bedrock, S3 and Vercel. That's ShipSignal."
- Flash `/admin` (agent capabilities + Skills & learning); end on `https://shipsignal-xi.vercel.app/`.

---

**Capture checklist (submission):**
- [ ] ≤ 2:45, uploaded to YouTube (unlisted is fine) — and the demo itself can publish to YouTube
- [ ] Said "Amazon Aurora PostgreSQL" out loud
- [ ] **Architecture diagram on screen** during beat 2 (and the close)
- [ ] **Moat stated twice** — beat 3 (provenance/governance) and beat 6 (compounding self-learning)
- [ ] Opened the **`3b1fed7f` run by URL** and drove the gates from its on-page links — **not** the
      `acme/launchpad` seed card on the home dashboard
- [ ] **Aurora-usage screenshot:** AWS Console → RDS → cluster **Available** (us-east-1), **OR**
      `SELECT count(*) FROM evidence_items;` against the Aurora endpoint
- [ ] Strong DB shot: a live cosine query —
      `SELECT evidence_type, left(redacted_excerpt,60) FROM evidence_items WHERE release_run_id='3b1fed7f-...' ORDER BY embedding <=> '<query-vec>'::vector LIMIT 5`
      — "Medusa plugin security hooks" ranks the `medusa-commerce` hooks first (real pgvector)

**Honesty note (keep the demo credible):** the primary run (agentic commerce, `3b1fed7f`) is fully
real — real diff, real Titan embeddings (8136/8136), **real Bedrock Nova authoring**, real ElevenLabs
media. The secondary hermes run uses the offline `DemoModelClient` for the LLM authoring only (one
`DEMO_MODE` flag from live; the agentic-commerce run is the proof). See `demo/VALIDATION.md`.
