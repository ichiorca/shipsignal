# ShipSignal — H0 Hackathon submission

**Live app:** https://shipsignal-xi.vercel.app
**Walk-through entry point:** https://shipsignal-xi.vercel.app/releases/49a31f1c-0cc7-4a56-a410-edefbffb0d2b
**Vercel Team ID:** `team_tkkqXRJtyzq0R4542ddf5pYo`
**AWS database used:** **Amazon Aurora PostgreSQL (Serverless v2)** + `pgvector`

## What it is
ShipSignal turns a GitHub **release diff** into approved, on-brand, multi-channel marketing
content — blog, changelog, social posts, customer email, and a narrated **audio/video** digest —
with **claim-level provenance** and **three human approval gates** (feature manifest → artifacts →
skill evolution). It never generates marketing copy straight from raw diffs: it builds an
evidence-backed feature manifest first, a human approves it, then content is generated with each
claim traceable to concrete evidence.

The live demo runs on the **real release diff** of `NousResearch/hermes-agent` v0.16.0 → v0.17.0.

## Why Amazon Aurora PostgreSQL is the heart of it
Every entity lives in Aurora; the data model is the product:

- **Tenancy by construction** — every row carries `release_run_id`; foreign keys cascade to
  `release_runs`, so a GDPR erasure of one release is a single delete that cleaves no orphans across
  evidence, features, artifacts, claims, and media.
- **Provenance lineage** — `artifact_claims → feature_evidence_links → evidence_items`; no claim is
  stored "approved" unless it links to real evidence.
- **pgvector semantic retrieval** — `evidence_items.embedding vector(1536)` with an HNSW cosine index
  ranks evidence and brand-voice exemplars natively in Postgres, no extra service.
- **Behaviour-as-data** — a versioned `skills` store (`current_version` + `versions{}` JSONB) and a
  `capability_skills` mapping let the system evolve without code changes.
- **34 deliberate migrations**, full type/CHECK constraints, idempotent upserts, dedupe keys, and
  perf indexes for the cross-run dashboard reads.

Aurora Serverless v2 (min 0.5 / max 2 ACU) keeps cost near zero while staying warm for judging.

## Architecture
See `demo/ARCHITECTURE.md` (diagram). Vercel (Next.js dashboard) → Aurora PostgreSQL over verified
TLS (RDS CA) → S3 for redacted evidence blobs + media (served via short-lived presigned URLs). A
LangGraph worker does the diff→evidence→signals→content pipeline; Amazon Bedrock is the LLM layer.

## What's real vs. demo (honest)
- **Real:** the GitHub diff ingestion, redaction, deterministic signal extraction, and **persistence
  to Aurora**; the **audio** (ElevenLabs TTS + ffmpeg → MP3/MP4 on S3); the full dashboard, the three
  gates, presigned media playback, and verified-TLS Aurora connectivity from Vercel.
- **Demo-mode:** the LLM-written feature manifest and artifact prose run on an offline model in this
  deployment because Amazon Bedrock on-demand inference is pending account activation. Bedrock is
  **not** a hackathon requirement; one env flag swaps the live client back in with zero code change.

## Judging-criteria fit
- **Technological implementation / DB:** a deep, deliberate Aurora schema (provenance graph, pgvector,
  versioned skills, tenancy), real ingestion → persistence, verified-TLS serverless connectivity.
- **Design:** review/approval UX with the three gates, evidence→claim provenance views, media preview.
- **Impact:** every team ships releases; turning a diff into governed, on-brand content with
  provenance is a real, production-shaped workflow.
- **Originality:** evidence-backed, human-gated content generation with claim-level provenance — not
  "diff → blogpost," but a governed manifest → approval → traceable content loop.
