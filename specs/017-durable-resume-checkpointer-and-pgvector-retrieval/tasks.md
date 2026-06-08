# Tasks — Durable resume checkpointer and pgvector semantic retrieval

- [x] **T1 — Durable Postgres checkpointer** Wire a Postgres LangGraph checkpointer in the worker entry; cross-process resume test proves a thread resumes after a fresh process start.
- [x] **T2 — Evidence embedding generation** Compute embeddings via the model/embedding seam and write them to `evidence_items.embedding` during evidence persistence.
- [x] **T3 — Activate vector retrieval** Use the pgvector cosine path for feature clustering / claim grounding with lexical fallback; test proves a vector hit (not just fallback).
- [x] **T4 — Release-intel node granularity** Register the §5.2 nodes discretely (or document an explicitly accepted grouping) for per-node checkpoint/observability.
