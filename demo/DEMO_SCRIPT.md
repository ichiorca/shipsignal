# Demo video script (target < 3:00) — ShipSignal

Live: https://shipsignal-xi.vercel.app · Run: `/releases/49a31f1c-0cc7-4a56-a410-edefbffb0d2b`

Record screen at 1280×720+, narrate the beats below. Keep it tight.

---

**0:00–0:20 — The problem (home page)**
> "Every release, teams hand-write the blog, changelog, social posts, and customer email — slowly,
> off-brand, and with no traceability. ShipSignal turns a GitHub release diff into approved,
> on-brand, multi-channel content with claim-level provenance."
- Show the Founder Dashboard; point to the Hermes Agent v0.16→v0.17 run.

**0:20–0:50 — Real evidence in Aurora (run overview → evidence)**
> "It starts from the real diff of NousResearch/hermes-agent v0.17. We ingest the diff, PRs, and
> issues, redact secrets and PII, extract deterministic signals, and persist everything to **Amazon
> Aurora PostgreSQL** — 757 evidence rows, each scoped to this release."
- Open the run; scroll the evidence list; show a redacted excerpt.

**0:50–1:25 — Gate #1: the feature manifest (/review)**
> "We don't generate copy from raw diffs. First we cluster evidence into an **evidence-backed feature
> manifest** — hardened build & CI, a steadier runtime adapter, refreshed onboarding — and a human
> approves it. Each feature links to the concrete evidence it came from."
- Open `/review`; show the 3 features + their evidence links + the approve gate.

**1:25–2:05 — Gate #2: generated artifacts + provenance (/artifacts)**
> "Only after approval do we generate content — a release blog, changelog, LinkedIn post, and
> customer email — each claim traceable back to evidence, and screened before a second human gate."
- Open `/artifacts`; open the release blog; show a claim → evidence provenance link.

**2:05–2:40 — The payoff: narrated media (/media)**
> "And a narrated audio digest and video — real text-to-speech, assembled with ffmpeg, served from
> **Amazon S3** via short-lived presigned URLs."
- Open `/media`; **play the MP3** (and/or the MP4 title-card video). Let a few seconds of audio play.

**2:40–3:00 — The stack + close**
> "Everything's on the AWS stack: Aurora PostgreSQL as the system of record with a deliberate
> provenance graph and pgvector retrieval, S3 for media, deployed on Vercel. Governed, on-brand
> release content — from diff to approved copy — with full provenance."
- Flash the architecture diagram (`demo/ARCHITECTURE.md`); end on the live URL.

---

**Capture checklist (submission):**
- [ ] < 3:00, uploaded to YouTube (unlisted is fine)
- [ ] Mention "Amazon Aurora PostgreSQL" out loud (judging criterion)
- [ ] Show the live Vercel URL on screen
- [ ] Aurora-usage screenshot for the write-up: AWS Console → RDS → `shipsignal-db` (region
      us-east-1) showing the cluster **Available**, **OR** a `SELECT count(*) FROM evidence_items;`
      against the Aurora endpoint
