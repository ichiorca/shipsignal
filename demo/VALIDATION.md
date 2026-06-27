# Validation matrix — ShipSignal (H0 Hackathon)

| Component | Status | How verified |
|---|---|---|
| TypeScript dashboard (types) | ✅ real | `tsc --noEmit` clean |
| TS unit + a11y suite | ✅ real | **435/435 pass** (`npm test`) |
| Worker pipeline (Python) | ✅ real | **402 pass** (`pytest`), incl. the diff→evidence→signals→graph→content e2e |
| GitHub diff ingestion | ✅ real | live compare for `NousResearch/hermes-agent` v0.16→v0.17 (300-file cap surfaced) |
| Redaction (PII/secrets) | ✅ real | fires on real data; no raw secret reaches Aurora/S3 (unit + live) |
| Deterministic signals | ✅ real | extractors run on the real patches |
| **Aurora PostgreSQL** | ✅ real | 34 migrations applied; 757 evidence + 3 features + 4 artifacts persisted; verified-TLS reads from Vercel |
| pgvector | ✅ real | extension created by migration 0003; `vector(1536)` columns live |
| **Amazon S3** media | ✅ real | MP3/MP4 uploaded to `shipsignal-media-897722692550`; presigned playback returns 200 |
| ElevenLabs audio | ✅ real | live TTS → `hermes_v0_17_digest.mp3` (18s) → ffmpeg MP4 |
| **Vercel deployment** | ✅ real | `https://shipsignal-xi.vercel.app` — all run pages 200, media streams live |
| Feature clustering (LLM) | ⚠️ demo-mode | offline `DemoModelClient` (Bedrock account-held); cites real evidence ids; live-swappable |
| Artifact prose (LLM) | ⚠️ demo-mode | offline `DemoModelClient`; representative, grounded; live-swappable via env flag |
| Bedrock Converse/Guardrails | ⏸️ pending | account on-demand inference activation (not a hackathon requirement) |

**Live verification (production, against Aurora + S3):**
- `GET /api/health` → 200
- `GET /releases/49a31f1c-…` (+ `/review`, `/artifacts`, `/media`) → all 200
- `GET /api/media/{id}/playback` → 302 → presigned `shipsignal-media-897722692550.s3.us-east-1.amazonaws.com/...` → 200 (MP3 + MP4)

**Bottom line:** the AWS-database-centric system (the hackathon's core requirement) is fully real and
deployed; only the two LLM authoring stages run offline, by one env flag, with zero code change to go live.
