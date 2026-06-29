# Demo video script (target < 3:00) — ShipSignal

**Primary run (fully real, agentic commerce):** https://shipsignal-xi.vercel.app/releases/3b1fed7f-eba1-487e-8382-0de8c26a33f3
Secondary (media-rich, offline-LLM): `/releases/49a31f1c-0cc7-4a56-a410-edefbffb0d2b` (hermes)

Record at 1280×720+, narrate the beats below, keep it tight. **Say "Amazon Aurora PostgreSQL" out
loud** (judging criterion) and **keep the live Vercel URL on screen**.

**The moat, in one line (land this twice):** the output is provable — an *evidence → claim provenance
graph* in Aurora behind *three human gates* — and the system *compounds*, mining reviewer edits into
versioned skills. A static generator can't copy trust, and can't catch a system that learns from its
own reviewers.

> Pacing: the narration below is ~390 words (~2:35 spoken at a natural pace), leaving headroom for
> clicks and transitions inside 3:00. If you run long, cut the second half of beats **6** and **8**.

---

**0:00–0:18 — The problem + the promise (home)**
> "Every release, teams hand-write the blog, changelog, social posts and customer email — slow,
> off-brand, and impossible to trace back to what actually shipped. ShipSignal turns one GitHub
> release diff into approved, on-brand, multi-channel content — authored by AWS, and provable down to
> the evidence."
- Show the dashboard; point to the **OrcaQubits / agentic-commerce-skills-plugins** run.

**0:18–0:42 — Architecture at a glance (show the diagram)**
> "Here's the whole system. A GitHub release diff — with its PRs and issues — flows into a LangGraph
> worker that collects, redacts, clusters, generates, and learns. Every row of state lives in **Amazon
> Aurora PostgreSQL**, our system of record; **Amazon Bedrock** does the authoring and embeddings; S3
> holds media. A Vercel dashboard is the only human surface — and the only place the three gates open."
- Put `demo/ARCHITECTURE.md`'s flowchart full-screen; trace GitHub → Worker → Aurora/Bedrock/S3 → Vercel.

**0:42–1:05 — Real evidence in Amazon Aurora (run → evidence)**
> "It starts from the real diff of our agentic-commerce repo. We ingest the diff, PRs and issues,
> redact secrets and PII, extract deterministic signals, and persist about eight thousand evidence
> rows to Amazon Aurora PostgreSQL — each scoped to this release, each embedded with Titan for
> pgvector semantic search."
- Open the run; scroll the evidence list; show a redacted excerpt.

**1:05–1:35 — Gate #1 + the structural moat (/review)**
> "Here's the moat. We never generate copy from a raw diff. Bedrock Nova clusters that evidence into a
> feature manifest — Medusa plugin hooks, a headless Spree storefront, a Spree checkout — and every
> feature links to the concrete evidence it came from. A human approves before a single word is
> written. That evidence-to-claim provenance graph, living in Aurora, is what makes the output
> trustworthy — and hard to copy."
- Open `/review`; show the 3 features, their evidence links, and the approve gate.

**1:35–2:00 — Gate #2: artifacts with claim-level provenance (/artifacts)**
> "Only after approval does Bedrock write the content — blog, changelog, LinkedIn, customer email —
> grounded in the approved features, screened by Bedrock Guardrails and deterministic checks, and
> approved by a second human. Open any artifact and every claim traces back to its evidence. No
> unlinkable claim is ever stored approved."
- Open `/artifacts`; open the release blog (real Nova prose about Medusa/Spree); show the provenance panel.

**2:00–2:20 — The payoff: narrated media + 1-click publish (/media)**
> "Then a narrated audio digest and video — real ElevenLabs text-to-speech, assembled with ffmpeg,
> stored in Amazon S3 and served through short-lived presigned URLs. Approved media publishes to
> YouTube in one click, with the OAuth token stored AES-encrypted in Aurora."
- Open `/media`; **play a few seconds of the MP3** and show the MP4; point to "Publish to YouTube".

**2:20–2:48 — The compounding moat: a self-learning loop (Gate #3)**
> "And it compounds. Reviewer edits are mined into a proposed next-version skill, gated by a third
> human, then written back as a versioned skill with its commit SHA recorded. Here the brand-voice
> skill was promoted to version 1.1.0 — live. Every correction makes the next release better — a
> static generator can't catch a system that learns from its own reviewers."
- Open `/skills` (brand-voice **v1.1.0**) and `/learning` (the promotion + trend).

**2:48–3:00 — The stack + close**
> "So: governed, on-brand, self-improving release content — diff to approved copy — on Amazon Aurora
> PostgreSQL, Bedrock, S3 and Vercel. Evidence-backed, three-gated, and compounding. That's
> ShipSignal."
- Flash the architecture diagram once more; end on the live URL.

---

**Capture checklist (submission):**
- [ ] < 3:00, uploaded to YouTube (unlisted is fine) — and the demo itself can publish to YouTube
- [ ] Said "Amazon Aurora PostgreSQL" out loud
- [ ] **Architecture diagram on screen** during beat 2 (and the close)
- [ ] **Moat stated twice** — Gate #1 (provenance/governance) and Gate #3 (compounding self-learning)
- [ ] Live Vercel URL on screen + the agentic-commerce run page loading real data
- [ ] **Aurora-usage screenshot:** AWS Console → RDS → cluster **Available** (us-east-1), **OR**
      `SELECT count(*) FROM evidence_items;` (→ ~8,880) against the Aurora endpoint
- [ ] Strong DB shot: a live cosine query —
      `SELECT evidence_type, left(redacted_excerpt,60) FROM evidence_items WHERE release_run_id='3b1fed7f-...' ORDER BY embedding <=> '<query-vec>'::vector LIMIT 5`
      — "Medusa plugin security hooks" ranks the `medusa-commerce` hooks first (real pgvector)

**Honesty note (keep the demo credible):** the primary run (agentic commerce, `3b1fed7f`) is fully
real — real diff, real Titan embeddings (8136/8136), **real Bedrock Nova authoring**, real ElevenLabs
media. The secondary hermes run uses the offline `DemoModelClient` only for the LLM authoring (one
`DEMO_MODE` flag from live; the agentic-commerce run is the proof). See `demo/VALIDATION.md`.
