# Validation matrix — ShipSignal (h01.devpost.com)

Status legend: ✅ real & verified · ⚠️ demo-mode (offline model, one env flag from live) · ⏸️ pending

| Component | Status | How verified |
|---|---|---|
| TypeScript dashboard (types) | ✅ | `tsc --noEmit` clean |
| TS unit + a11y suite | ✅ | **485 pass** (`node --test`) |
| Worker pipeline (Python) | ✅ | **420 pass** (`pytest`), incl. diff→evidence→signals→content e2e **and** the skill-evolution (Gate #3) e2e |
| GitHub diff ingestion | ✅ | live compare for `NousResearch/hermes-agent` v0.16→v0.17 (300-file cap surfaced) |
| Redaction (PII/secrets) | ✅ | fires on real data; no raw secret reaches Aurora/S3 (unit + live) |
| Deterministic signals | ✅ | extractors run on the real patches |
| **Aurora PostgreSQL** | ✅ | **38 migrations applied**; demo run = **744 evidence + 3 features + 4 artifacts + 2 media**; verified-TLS reads from Vercel |
| Provenance graph | ✅ | `artifact_claims → evidence` schema + checks live; claim rows populated by the content graph (a run with full claim extraction shows 3 linked claims) |
| Tenancy / GDPR cascade | ✅ | every row keyed by `release_run_id`; FK `ON DELETE CASCADE` to `release_runs` |
| **pgvector (real retrieval)** | ✅ | extension + `vector(1536)` (0003) + **HNSW index** (0018); **real Bedrock Titan embeddings populated for 741/747 evidence rows**; cosine query verified (a "build & CI reliability" query ranks the CI-workflow diffs first), lexical fallback for the rest |
| **Self-learning loop (Gate #3)** | ✅ | reviewer signals → candidate → promote; **`brand-voice` promoted to v1.1.0** (`skills.current_version`, `skill_revision_candidates.status='promoted'`) |
| Capability/agent governance | ✅ | `capability_skills` (20 rows) + `agent_capabilities` (10 rows), DB-overridable, **editable from the dashboard** |
| **Amazon S3** media | ✅ | MP3 + MP4 in `shipsignal-media-897722692550`; presigned playback → 200 |
| ElevenLabs audio | ✅ | live TTS → `hermes_v0_17_digest.mp3` (~18s) → ffmpeg MP4 |
| YouTube publish | ✅ (built) | human-gated, idempotent upload; **dry-runs safely without creds**, live when an account is connected |
| Encrypted OAuth connections | ✅ | `connections` table; refresh token **AES-256-GCM**-encrypted (ciphertext only in DB), key in env |
| **Vercel deployment** | ✅ | `https://shipsignal-xi.vercel.app` — all run pages + `/skills` `/agents` `/capabilities` `/connections` return 200; media streams live |
| **Bedrock LLM authoring (Converse/Nova)** | ✅ (proven) | **real on the OrcaQubits run `3b1fed7f`** — Amazon **Nova** clustered the diff into 3 features and wrote all 4 artifacts; the hermes run uses the offline `DemoModelClient` for a deterministic, media-rich walkthrough (live-swappable via `DEMO_MODE`) |
| Titan embeddings | ✅ | real Bedrock Titan v1 (1536-dim) — 741/747 (hermes) + **8136/8136 (OrcaQubits)** evidence rows; verified by live cosine queries |
| Bedrock Guardrails | ⏸️ | the published-Guardrail safety node is pending; deterministic policy checks run regardless |

**Live verification (production, against Aurora + S3):**
- `GET /api/health` → 200
- `GET /releases/49a31f1c-…` (+ `/review`, `/artifacts`, `/media`) → 200
- `GET /api/media/{id}/playback` → 302 → presigned `shipsignal-media-897722692550.s3.us-east-1.amazonaws.com/...` → 200 (MP3 + MP4)
- `GET /skills` shows `brand-voice` **v1.1.0**; `GET /connections` → 200

## Second run — fully real Bedrock Nova authoring (`3b1fed7f`)
A second end-to-end run proving the LLM-authoring path runs on real Bedrock inference:
- **Repo:** `OrcaQubits/agentic-commerce-skills-plugins`, diff `7473b6a` → `4366f7c` (300-file cap surfaced honestly)
- **~8,100 evidence rows** (real diff → redact → persist); **8136/8136 embedded** with real Titan vectors
- **3 features clustered by Amazon Nova** (Medusa Plugin Hooks, Spree Headless Storefront, Spree Checkout) + **4 Nova-written artifacts** (blog/changelog/LinkedIn/email)
- **Cosine retrieval verified:** "Medusa plugin security hooks" → the `medusa-commerce` plugin-hooks code/docs (distance 0.33)
- **Cross-account by design:** Bedrock/Nova on a second AWS account (which has Nova quota); S3 + Aurora on the shipsignal account — split credentials in one process, IAM restored after
- **Live:** `/releases/3b1fed7f-eba1-487e-8382-0de8c26a33f3` (run/review/artifacts → 200)

**Bottom line:** the AWS-database-centric system (the hackathon's core requirement) is fully real and
deployed — Aurora schema, provenance graph, **real pgvector retrieval on real Bedrock Titan
embeddings**, the three gates, a real promoted skill version, S3 media, encrypted connections — **and
the LLM-authoring path is proven on a real Bedrock Nova run**. Nothing essential is stubbed.
