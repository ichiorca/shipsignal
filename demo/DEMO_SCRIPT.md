# Demo video script (target < 3:00) — ShipSignal

Live: https://shipsignal-xi.vercel.app · Run: `/releases/49a31f1c-0cc7-4a56-a410-edefbffb0d2b`

Record at 1280×720+, narrate the beats below, keep it tight. **Say "Amazon Aurora PostgreSQL" out
loud** (judging criterion) and **keep the live Vercel URL on screen**.

---

**0:00–0:18 — The problem (home)**
> "Every release, teams re-write the blog, changelog, social posts, and customer email by hand —
> slowly, off-brand, untraceable. ShipSignal turns a GitHub release diff into approved, on-brand,
> multi-channel content — and it can prove where every claim came from."
- Show the dashboard; point to the Hermes Agent v0.16→v0.17 run.

**0:18–0:45 — Real evidence in Amazon Aurora (run → evidence)**
> "It starts from the real diff of NousResearch/hermes-agent. We ingest the diff, PRs, and issues,
> redact secrets and PII, extract deterministic signals, and persist everything to Amazon Aurora
> PostgreSQL — 744 evidence rows, each scoped to this release."
- Open the run; scroll the evidence list; show a redacted excerpt.

**0:45–1:15 — Gate #1: the evidence-backed feature manifest (/review)**
> "We never generate copy from a raw diff. First we cluster evidence into a feature manifest —
> hardened build & CI, a steadier runtime adapter, refreshed onboarding — and each feature links to
> the concrete evidence it came from. A human approves before anything is written."
- Open `/review`; show the 3 features, their evidence links, and the approve gate.

**1:15–1:50 — Gate #2: generated artifacts (/artifacts)**
> "Only after approval do we generate content — release blog, changelog, LinkedIn post, customer
> email. Each artifact's claims are extracted, linked to evidence, and screened by deterministic
> checks plus Bedrock Guardrails before a second human approves it."
- Open `/artifacts`; open the release blog; show the artifact + the claim/provenance panel.

**1:50–2:20 — The payoff: narrated media + 1-click publish (/media)**
> "Then a narrated audio digest and a video — real text-to-speech, assembled with ffmpeg, stored in
> Amazon S3 and served through short-lived presigned URLs. Approved media publishes to YouTube in one
> click — the OAuth token is stored encrypted in Aurora."
- Open `/media`; **play a few seconds of the MP3** and show the MP4; point to the "Publish to YouTube"
  button (and `/connections` if connected).

**2:20–2:45 — The differentiator: a self-learning loop (Gate #3)**
> "And ShipSignal learns. Reviewer edits are mined into a proposed next-version skill, and a third
> human gate approves it. Here, the brand-voice skill was promoted to version 1.1.0 — the system
> improving itself from human feedback, with full provenance."
- Open `/skills` (brand-voice now **v1.1.0**) and `/learning` (the promotion + trend).

**2:45–3:00 — The stack + close**
> "Everything runs on AWS: Amazon Aurora PostgreSQL as the system of record — 38 migrations, a
> provenance graph, pgvector retrieval, versioned skills — with S3 for media, deployed on Vercel.
> Governed, on-brand, self-improving release content, from diff to approved copy."
- Flash the architecture diagram (`demo/ARCHITECTURE.md`); end on the live URL.

---

**Capture checklist (submission):**
- [ ] < 3:00, uploaded to YouTube (unlisted is fine) — and the demo itself can publish to YouTube
- [ ] Said "Amazon Aurora PostgreSQL" out loud
- [ ] Live Vercel URL on screen + the run page loading real data
- [ ] **Aurora-usage screenshot** for the write-up: AWS Console → RDS → cluster **Available** (region
      us-east-1), **OR** a `SELECT count(*) FROM evidence_items;` (→ 747) against the Aurora endpoint
- [ ] Optional strong shot: `/skills` showing brand-voice **v1.1.0** (the learning loop in the data)

**Honesty note (keep the demo credible):** only the two LLM authoring stages (Bedrock Converse) run on
an offline model here (Converse quota pending — not a hackathon requirement). Everything else —
Aurora persistence, **real pgvector retrieval on real Bedrock Titan embeddings (741/747 rows)**, the
three gates, the promoted skill, the media, presigned playback — is real. See `demo/VALIDATION.md`.

**Optional strong DB shot:** run a live cosine query against Aurora —
`SELECT evidence_type, left(redacted_excerpt,60) FROM evidence_items ORDER BY embedding <=> '<query-vec>'::vector LIMIT 5`
— returning CI/workflow diffs for a "build & CI reliability" query proves real pgvector retrieval.
