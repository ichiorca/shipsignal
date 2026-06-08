"""T2 (spec 017) — the ``EmbeddingClient`` port plus a deterministic in-memory fake.

P1 (Substrate) / constitution §3: Amazon Bedrock is the only model gateway. Text
*generation* goes through Converse (``ModelClient``); evidence *embeddings* are a
distinct Bedrock modality with no Converse surface, so the runtime adapter
(``bedrock_client.BedrockEmbeddingClient``) calls the embedding model and the rest of the
worker depends only on this narrow Protocol. Keeping it separate from ``ModelClient``
(interface segregation) means a node that only needs generation never gains an embedding
dependency, and the unit gate exercises the embedding-aware nodes without boto3.

P5 (Safety rails): only ``redacted_excerpt`` text is ever embedded — the embedding seam
sits downstream of the redact node (constitution §5 "redact before … before LLM"), so no
raw PII/secret text reaches the embedding model. Vectors are ``EMBEDDING_DIMS``-long to
match the ``evidence_items.embedding vector(1536)`` column (PRD §10.1).
"""

from __future__ import annotations

import hashlib
import math
from typing import Protocol, runtime_checkable

# Matches the evidence_items.embedding vector(1536) column (PRD §10.1 / migration 0003).
# Bedrock's Titan Text Embeddings v2 emits 1024 by default but supports 1536; the runtime
# adapter requests this dimensionality so the stored vector always fits the column.
EMBEDDING_DIMS = 1536


@runtime_checkable
class EmbeddingClient(Protocol):
    """Embed a redacted text into a fixed-dimensionality vector (PRD §11 retrieval).

    Implementations MUST return an ``EMBEDDING_DIMS``-long vector and treat the input as
    already-redacted (the seam sits after the redact node, §5). ``BedrockEmbeddingClient``
    satisfies it at runtime; the unit gate uses ``HashingEmbeddingClient``.
    """

    def embed(self, text: str) -> list[float]: ...


class HashingEmbeddingClient:
    """Deterministic, dependency-free ``EmbeddingClient`` for unit/dev runs.

    Hashes content tokens into a fixed bag-of-words vector and L2-normalizes it, so two
    texts that share vocabulary land near each other under cosine distance — enough for a
    pgvector-path test to surface a real nearest neighbour rather than only proving the
    lexical fallback. NOT for production (it carries no learned semantics); the runtime
    adapter calls the Bedrock embedding model instead.
    """

    def __init__(self, dims: int = EMBEDDING_DIMS) -> None:
        self._dims = dims

    def embed(self, text: str) -> list[float]:
        vector = [0.0] * self._dims
        for token in text.lower().split():
            # Stable per-token bucket; SHA-256 keeps the mapping reproducible across runs.
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            bucket = int.from_bytes(digest[:4], "big") % self._dims
            vector[bucket] += 1.0
        norm = math.sqrt(sum(component * component for component in vector))
        if norm == 0.0:
            return vector
        return [component / norm for component in vector]
