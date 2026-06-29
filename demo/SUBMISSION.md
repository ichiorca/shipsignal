# ShipSignal — Devpost submission (h01.devpost.com)

**Live app:** https://shipsignal-xi.vercel.app
**Walk-through run (media-rich):** https://shipsignal-xi.vercel.app/releases/49a31f1c-0cc7-4a56-a410-edefbffb0d2b
**Fully-real run (real Bedrock Nova authoring):** https://shipsignal-xi.vercel.app/releases/3b1fed7f-eba1-487e-8382-0de8c26a33f3
**Vercel Team ID:** `team_tkkqXRJtyzq0R4542ddf5pYo`
**AWS database:** **Amazon Aurora PostgreSQL (Serverless v2)** + `pgvector`
**Docs:** architecture → `demo/ARCHITECTURE.md` · demo script → `demo/DEMO_SCRIPT.md` · what's real → `demo/VALIDATION.md`

---

## One-liner
ShipSignal turns a GitHub **release diff** into approved, on-brand, multi-channel launch content — blog, changelog, social, customer email, and a narrated **audio + video** digest — where **every claim is traceable to concrete evidence**, **three humans must approve**, and the system **learns from each edit**. The data model in **Amazon Aurora PostgreSQL** is the product.

It never writes marketing copy from a raw diff. It builds an evidence-backed **feature manifest** → a human approves → it generates content with **claim-level provenance** → a human approves → optional media → and reviewer edits feed a **self-learning skill loop** gated by a third human.

The live deployment runs on the **real release diff** of `NousResearch/hermes-agent` v0.16.0 → v0.17.0 (744 evidence rows persisted to Aurora).

---

## Why Amazon Aurora PostgreSQL is the heart of it (DB / data-model criterion)
**38 deliberate migrations.** Every entity lives in Aurora; the schema encodes the product's guarantees, not just its tables:

- **Tenancy by construction** — every row carries `release_run_id`; foreign keys `ON DELETE CASCADE` to `release_runs`. A GDPR erasure of one release is a single delete that cleaves no orphans across evidence, features, artifacts, claims, and media.
- **A provenance graph, not flat rows** — `artifact_claims → (claim_evidence_links) → feature_evidence_links → evidence_items`. A generated claim is never stored "approved" unless it links to real evidence; the dashboard renders the lineage.
- **pgvector, Postgres-native — and real** — `evidence_items.embedding vector(1536)` with an **HNSW cosine index** (migrations 0003/0018). **Real Amazon Bedrock Titan embeddings are populated for 741/747 evidence rows**, and cosine retrieval is verified end-to-end (a "build & CI reliability" query returns the CI-workflow diffs at the top). A lexical fallback covers the rest — no extra service, search lives in Postgres.
- **Behaviour-as-data (the system evolves without code changes):**
  - a **versioned skills store** (`skills.current_version` + `versions{}` JSONB) — 17 skills live;
  - a **capability→skill** map (`capability_skills`, 20 rows) and an **agent→capability** allowlist (`agent_capabilities`, 10 rows), both DB-overridable and editable from the dashboard;
  - a **self-learning ledger** (`learning_signals`, `skill_revision_candidates`, suppression cooldowns) that mines reviewer edits into proposed next-version skills.
- **Governed connections, encrypted at rest** — `connections` stores an OAuth refresh token **AES-256-GCM-encrypted** (ciphertext + IV + auth tag; key in env), powering one-click YouTube publishing.
- **Production-shaped rigor** — full type/CHECK constraints, idempotent upserts, two-phase dedupe markers for outbound publishes, a durable LLM-response cache, and perf indexes for cross-run dashboard reads.

Aurora Serverless v2 (min 0.5 / max 2 ACU) keeps cost near zero while staying warm for judging.

## Deployment (deployment criterion)
**Vercel** (Next.js App Router + React 19 dashboard) → **Aurora PostgreSQL** over **verified TLS** (RDS CA bundle, validated from serverless) → **Amazon S3** for redacted evidence blobs + media (served only via **short-lived presigned GET URLs**, never a public object). A **LangGraph** worker runs the diff→evidence→signals→content→media pipeline; **Amazon Bedrock** is the LLM layer. See `demo/ARCHITECTURE.md`.

## The three human gates + the learning loop (design + originality criteria)
1. **Gate #1 — feature manifest:** evidence is clustered into candidate features; a human approves before any copy is generated.
2. **Gate #2 — artifacts:** generated content is claim-extracted, evidence-linked, and policy/guardrail-screened; a human approves before publish. A blocking check marks an artifact `blocked`.
3. **Gate #3 — skill evolution:** reviewer edits/rejections are mined, clustered, and turned into a **next-version skill proposal**; a human approves before any repo `SKILL.md` is overwritten. **Demonstrated live:** the `brand-voice` skill was promoted to **v1.1.0** through this loop (visible on `/skills` and `/learning`).

## What's real vs. demo (honest — judges can inspect)
- **Real:** GitHub diff ingestion, redaction, deterministic signal extraction, and **persistence to Aurora** (744 evidence rows); **real pgvector retrieval** — Amazon Bedrock Titan embeddings populated for **741/747** evidence rows with verified cosine ranking; the **three approval gates**; the **self-learning loop** (a real promoted skill version); the **narrated media** (ElevenLabs TTS + ffmpeg → MP3 **and** MP4 on S3) with presigned playback; the **YouTube publish** + **encrypted OAuth connections** features; verified-TLS Aurora connectivity from Vercel; 485 TS + 420 Python tests green.
- **LLM authoring — proven real on Bedrock:** the second run (`3b1fed7f`, `OrcaQubits/agentic-commerce-skills-plugins`) was authored end-to-end by **real Amazon Bedrock (Nova)** — Nova clustered the diff into the feature manifest and wrote all four artifacts (blog/changelog/LinkedIn/email), with **8136/8136** of its evidence rows embedded by real Titan and cosine retrieval verified. So the LLM stage is not "trust the flag" — there is a live run that did it for real.
- **Why hermes uses the offline model:** the primary walk-through run (`49a31f1c`) uses the offline `DemoModelClient` for deterministic, media-rich demoing (its Bedrock account's Converse quota is pending an increase). It's **one env flag** from live — and the OrcaQubits run is the proof. Bedrock authoring is **not** a hackathon requirement; schema, gates, learning loop, and vector retrieval are real on both runs.

> **Two demonstration runs:** hermes = real evidence + real embeddings + real media (offline LLM, for a deterministic walkthrough); **OrcaQubits = real evidence + real embeddings + real Bedrock Nova authoring** (the fully-real proof). Hermes data is preserved unchanged.

## Impact
Every team ships releases and re-writes the same launch content by hand — slowly, off-brand, untraceable. ShipSignal makes that a **governed, evidence-backed, self-improving** workflow: diff → approved, on-brand, multi-channel content with claim-level provenance, plus one-click distribution. It's production-shaped, not a toy.

## Judging-criteria fit (summary)
- **Technological implementation / DB:** a deep, deliberate Aurora schema — provenance graph, pgvector + HNSW, versioned skills, capability/agent governance, a learning ledger, encrypted connections — across 38 migrations, with real ingestion→persistence and verified-TLS serverless connectivity.
- **Deployment:** live on Vercel + Aurora + S3; every run page returns 200; media streams via presigned URLs.
- **Design:** the three-gate review/approval UX, evidence→claim provenance views, media preview + one-click publish, and dashboard-editable governance (agents/capabilities/connections).
- **Impact:** a real, recurring, expensive workflow turned governed and traceable.
- **Originality:** not "diff → blogpost." An evidence-backed manifest → human-gated, claim-traceable content → a **self-learning skill loop** that improves the system from human edits.
