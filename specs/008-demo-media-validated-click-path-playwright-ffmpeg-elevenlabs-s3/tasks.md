# Tasks — Demo media: validated click-path → Playwright → ffmpeg → ElevenLabs → S3

- [ ] **T1 — Migration for media_assets** Create media asset table (release_run_id, feature_id, type, s3_uri, duration, provenance).
- [ ] **T2 — generate_click_path_json + validate_click_path nodes** Generate click-path from the approved demo script and validate against a strict JSON schema (allowed actions/selectors only) before any execution; reject on violation.
- [ ] **T3 — run_playwright_capture node** Execute the validated click-path with Playwright on the Actions runner using synthetic/fixture data; capture screenshots/video.
- [ ] **T4 — generate_narration node (ElevenLabs)** Generate narration from the audio-digest/demo script; read ELEVENLABS_API_KEY at call time, dedupe via content hash of (text+voice_id+model_id+output_format), bound concurrency, branch on 429 codes. Stubbed in CI.
- [ ] **T5 — assemble_video_ffmpeg + store_media_s3 + persist_media_asset** Materialize audio fully before ffmpeg assembly; upload to S3 (sanitized keys, private), persist media_assets row.
- [ ] **T6 — Dashboard media preview** Preview media via short-expiry presigned URL; accessible player controls.
