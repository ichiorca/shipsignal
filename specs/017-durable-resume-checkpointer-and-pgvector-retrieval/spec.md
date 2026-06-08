# Durable resume checkpointer and pgvector semantic retrieval

> PRD anchors: 5.6 / 3.1 (resume the same thread_id across separate runs); 11. Retrieval Strategy (Aurora + pgvector); 5.2 release-intelligence graph node granularity

## Summary

Two PRD guarantees are wired only partially. Resume relies on the in-process `MemorySaver`, so the §5.6 "resume the same thread_id" guarantee will not survive the separate GitHub Actions invocations the §3.1 runtime split implies. And pgvector is schema-real with working cosine-query code, but the evidence write path never populates `embedding`, so §11 semantic retrieval silently falls back to lexical. Make resume durable and activate vector retrieval. Optionally split the §5.2 nodes for per-node checkpoint granularity.

## Acceptance criteria

- A durable (Postgres) LangGraph checkpointer is wired in the worker entry point; a thread started in one process resumes correctly in a separate process invocation (proven by a test).
- Evidence embeddings are computed (via the `ModelClient`/embedding seam) and written to `evidence_items.embedding`; feature clustering and claim grounding use the vector path with lexical fallback, and a test proves a vector hit.
- The release-intelligence graph registers the §5.2 nodes discretely (or documents an explicitly accepted grouping) so per-node checkpoint/observability matches the other three graphs.
- No regression to existing graph behavior, gates, or the transient-retry wrapper.
