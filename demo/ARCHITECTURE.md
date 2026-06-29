# ShipSignal — Architecture (h01.devpost.com)

**ShipSignal** turns a GitHub release diff into approved, on-brand, multi-channel launch content
(blog, changelog, social, customer email, narrated audio + video) — with **claim-level provenance**,
**three human approval gates**, and a **self-learning skill loop**. The system of record is **Amazon
Aurora PostgreSQL**.

## AWS database used
**Amazon Aurora PostgreSQL (Serverless v2)** — the single source of truth for every entity, with
`pgvector` (HNSW) for semantic retrieval. **38 migrations**, full CHECK/type constraints, a provenance
graph, versioned behaviour, and encrypted connections.

```mermaid
flowchart LR
  subgraph Ingest["Ingestion (untrusted input)"]
    GH["GitHub Releases / Compare API\n(diff + PRs + issues)"]
  end

  subgraph Worker["Release Worker — LangGraph (Python)"]
    direction TB
    EV["collect → redact → deterministic signals"]
    FE["cluster features  ──▶ Gate #1 (human)"]
    CO["generate artifacts → extract claims →\nlink to evidence → guardrails ──▶ Gate #2 (human)"]
    ME["media: narration (TTS) + ffmpeg video"]
    SL["mine reviewer edits → skill candidate ──▶ Gate #3 (human)"]
    EV --> FE --> CO --> ME
    CO -. reviewer edits .-> SL
  end

  subgraph AWS["AWS"]
    AUR[("Amazon Aurora PostgreSQL\nrelease_runs · evidence_items (pgvector/HNSW)\nfeature_clusters · artifacts · artifact_claims (+evidence links)\nskills (versioned) · capability_skills · agent_capabilities\nlearning_signals · skill_revision_candidates\nmedia_assets · connections (encrypted) · brand brain")]
    S3[("Amazon S3\nredacted evidence blobs · media (mp3/mp4)")]
    BR["Amazon Bedrock\nConverse + Guardrails + Titan embeddings\n(LLM layer · demo-mode here)"]
  end

  subgraph Front["Vercel"]
    UI["Next.js dashboard (App Router, React 19)\nreview · approve (×3 gates) · provenance ·\nmedia + 1-click YouTube · governance/connections"]
  end

  GH --> EV
  Worker -->|redacted rows + provenance| AUR
  Worker -->|blobs / media| S3
  Worker -.->|prompts / embeddings| BR
  UI -->|verified TLS, parameterised SQL| AUR
  UI -->|short-lived presigned GET| S3
  UI -.->|OAuth upload (token decrypted server-side)| YT["YouTube Data API"]
```

## Why the Aurora data model is the centerpiece
- **Tenancy by construction:** every row carries `release_run_id`; FKs `ON DELETE CASCADE` to
  `release_runs`, so GDPR erasure of one release is a single cascading delete across evidence,
  features, artifacts, claims, and media.
- **Provenance graph:** `artifact_claims → claim/feature_evidence_links → evidence_items`; no
  unlinkable claim is stored approved, and the lineage is rendered in the UI.
- **pgvector semantic retrieval (real):** `evidence_items.embedding vector(1536)` + an **HNSW cosine
  index** (migrations 0003 / 0018). **Real Bedrock Titan embeddings populated for 741/747 evidence
  rows**; cosine retrieval verified end-to-end (a "build & CI reliability" query ranks the CI-workflow
  diffs first). Lexical fallback covers the rest — Postgres-native, no extra service.
- **Behaviour-as-data:** a **versioned `skills`** store (`current_version` + `versions{}` JSONB), a
  **`capability_skills`** map and an **`agent_capabilities`** allowlist (both DB-overridable, edited
  from the dashboard), and a **self-learning ledger** (`learning_signals`, `skill_revision_candidates`,
  suppression cooldowns) — the system evolves without code changes. *(Live: `brand-voice` promoted to
  v1.1.0 through Gate #3.)*
- **Encrypted connections:** `connections` holds an OAuth refresh token **AES-256-GCM-encrypted**
  (ciphertext + IV + tag; key in env) for one-click YouTube publishing — ciphertext only in the DB.
- **Production-shaped rigor:** idempotent upserts, two-phase publish dedupe markers, a durable
  LLM-response cache, dedupe keys, and perf indexes for cross-run dashboard reads.

## Stack & data flow
**Vercel** (Next.js App Router + React 19) renders review/approval, provenance, media, and governance,
reading Aurora over **verified TLS** with parameterised SQL and reaching S3 only via **short-lived
presigned GET URLs**. A **LangGraph** Python worker runs four graphs — release-intelligence, content,
media, and skill-learning — orchestrating Gates #1–#3 as human-approval interrupts. **Amazon Bedrock**
(Converse + Guardrails + Titan) is the LLM layer.

## Honest note for judges (live vs. demo)
The diff → evidence → deterministic-signals → **Aurora persistence** path runs on **real** GitHub data
(`NousResearch/hermes-agent` v0.16→v0.17). **pgvector retrieval is real** (real Bedrock Titan
embeddings populated for 741/747 evidence rows; cosine ranking verified). The **media** is **real**
(TTS + ffmpeg → MP3 **and** MP4 on S3). The **three gates** and the **self-learning loop** are real (a
real promoted skill version). The **LLM authoring path is proven real**: a second run
(`3b1fed7f`, `OrcaQubits/agentic-commerce-skills-plugins`) was clustered + written end-to-end by
**Amazon Bedrock Nova** (cross-account, since that account has Nova quota). The hermes walk-through run
uses the offline `DemoModelClient` for deterministic, media-rich demoing — **one `DEMO_MODE` flag**
from live, and the OrcaQubits run is the proof. Schema, data flow, gates, learning loop, and vector
retrieval are exactly as shipped.
