# Demo video script (target < 3:00) — ShipSignal

**Primary run (fully real, agentic commerce):** https://shipsignal-xi.vercel.app/releases/3b1fed7f-eba1-487e-8382-0de8c26a33f3
Secondary (media-rich, offline-LLM): `/releases/49a31f1c-0cc7-4a56-a410-edefbffb0d2b` (hermes)

Record at 1280×720+, narrate the beats below, keep it tight. **Say "Amazon Aurora PostgreSQL" out
loud** (judging criterion) and **keep the live Vercel URL on screen**.

---

**0:00–0:18 — The problem (home)**
> "Every release, teams re-write the blog, changelog, social posts, and customer email by hand —
> slowly, off-brand, untraceable. ShipSignal turns a GitHub release diff into approved, on-brand,
> multi-channel content — authored by AWS, and provable to the evidence."
- Show the dashboard; point to the **OrcaQubits / agentic-commerce-skills-plugins** run.

**0:18–0:45 — Real evidence in Amazon Aurora (run → evidence)**
> "This starts from the real diff of our agentic-commerce skills repo, between two commits. We ingest
> the diff, PRs, and issues, redact secrets and PII, extract deterministic signals, and persist
> everything to Amazon Aurora PostgreSQL — about eight thousand evidence rows, each scoped to this
> release, each embedded for semantic search with pgvector."
- Open the run; scroll the evidence list; show a redacted excerpt.

**0:45–1:15 — Gate #1: the Nova-clustered feature manifest (/review)**
> "We never generate copy from a raw diff. Amazon Bedrock Nova clusters the evidence into a feature
> manifest — Medusa plugin hooks, a headless Spree storefront, a Spree checkout implementation — and
> each feature links to the concrete evidence it came from. A human approves before anything is
> written."
- Open `/review`; show the 3 features, their evidence links, and the approve gate.

**1:15–1:50 — Gate #2: artifacts written by real Bedrock (/artifacts)**
> "Only after approval does Bedrock Nova write the content — release blog, changelog, LinkedIn post,
> customer email — grounded in the approved features, screened by deterministic checks, and approved
> by a second human."
- Open `/artifacts`; open the release blog (real Nova prose about Medusa/Spree); show the provenance panel.

**1:50–2:20 — The payoff: narrated media (/media)**
> "Then a narrated audio digest and a video — real ElevenLabs text-to-speech, assembled with ffmpeg,
> stored in Amazon S3 and served through short-lived presigned URLs. Approved media publishes to
> YouTube in one click, with the OAuth token stored encrypted in Aurora."
- Open `/media`; **play a few seconds of the MP3** and show the MP4; point to "Publish to YouTube".

**2:20–2:45 — The differentiator: a self-learning loop (Gate #3)**
> "And ShipSignal learns. Reviewer edits are mined into a proposed next-version skill, gated by a
> third human. Here the brand-voice skill was promoted to version 1.1.0 — the system improving itself
> from human feedback, with full provenance."
- Open `/skills` (brand-voice **v1.1.0**) and `/learning` (the promotion + trend).

**2:45–3:00 — The stack + close**
> "Everything runs on AWS: Amazon Aurora PostgreSQL as the system of record — 38 migrations, a
> provenance graph, real pgvector retrieval — Amazon Bedrock for authoring and embeddings, S3 for
> media, deployed on Vercel. Governed, on-brand, self-improving release content, from diff to
> approved copy."
- Flash the architecture diagram (`demo/ARCHITECTURE.md`); end on the live URL.

---

**Capture checklist (submission):**
- [ ] < 3:00, uploaded to YouTube (unlisted is fine) — and the demo itself can publish to YouTube
- [ ] Said "Amazon Aurora PostgreSQL" out loud
- [ ] Live Vercel URL on screen + the agentic-commerce run page loading real data
- [ ] **Aurora-usage screenshot:** AWS Console → RDS → cluster **Available** (us-east-1), **OR**
      `SELECT count(*) FROM evidence_items;` (→ ~8,880) against the Aurora endpoint
- [ ] Strong DB shot: a live cosine query —
      `SELECT evidence_type, left(redacted_excerpt,60) FROM evidence_items WHERE release_run_id='3b1fed7f-...' ORDER BY embedding <=> '<query-vec>'::vector LIMIT 5`
      — "Medusa plugin security hooks" ranks the `medusa-commerce` hooks first (real pgvector)
- [ ] Optional: `/skills` showing brand-voice **v1.1.0** (the learning loop in the data)

**Honesty note (keep the demo credible):** the primary run (agentic commerce, `3b1fed7f`) is fully
real — real diff, real Titan embeddings (8136/8136), **real Bedrock Nova authoring**, real ElevenLabs
media. The secondary hermes run uses the offline `DemoModelClient` only for the LLM authoring (one
`DEMO_MODE` flag from live; the agentic-commerce run is the proof). See `demo/VALIDATION.md`.
