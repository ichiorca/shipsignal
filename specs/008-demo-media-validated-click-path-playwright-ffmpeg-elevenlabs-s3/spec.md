# Demo media: validated click-path → Playwright → ffmpeg → ElevenLabs → S3

> PRD anchors: 5.4 Media generation graph; 8.1 Initial artifact types (demo_script, release_audio_digest); 1.1 Core goals (#6)

## Summary

media_generation_graph turns an approved demo script into a schema-validated click-path, captures it deterministically with Playwright, generates ElevenLabs narration, assembles with ffmpeg, stores in S3, and persists the media asset for dashboard preview.

## Acceptance criteria

- An invalid/malicious click-path (unknown action or selector) is rejected by schema validation and never reaches Playwright.
- Narration uses a server-side key (never exposed to client/Playwright context) and is content-hash-idempotent; CI uses a stub by default.
- ffmpeg only assembles after audio is fully materialized; output stored in S3 and referenced by key.
- Media reaches the client only via presigned URL; player is WCAG 2.2 AA.
- media graph runs only on the Actions runner; no diff/Playwright/ffmpeg in the Vercel app.
