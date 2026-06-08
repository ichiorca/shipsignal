"""T3/T4/T5 (spec 006) — the ports the claim/check/Gate-2 nodes depend on, plus in-memory
fakes for the unit gate.

P4 (Storage): the nodes never import psycopg/boto3 directly; they depend on these narrow
Protocols. The durable implementations live in runtime-only modules (``aurora_claims``,
``guardrails_client``) imported by ``__main__``, so the unit gate exercises the node logic
against the fakes here without a DB, S3, or Bedrock — mirroring the evidence/feature/content
slices.

constitution §5: ``ClaimEvidenceMatcher`` surfaces only redacted evidence excerpts (claim
grounding never sees raw text). ``GuardrailScanner`` is the §12.2 safety boundary that must
run before Gate #2. ``ClaimSink``/``ArtifactReviewSink`` write the §10.3 provenance the
audit trail depends on.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from release_worker.claim_models import (
    ArtifactClaim,
    ClaimEvidenceCandidate,
    ClaimEvidenceLink,
    GuardrailVerdict,
)


@runtime_checkable
class ClaimEvidenceMatcher(Protocol):
    """Surface candidate evidence items for a claim (PRD §11 claim grounding / §5.3
    link_claims_to_evidence).

    Implementations MAY pre-rank by pgvector similarity, but MUST return only redacted
    excerpts (constitution §5). The node applies the deterministic lexical support score on
    top, so the binding link decision is reproducible. ``AuroraEvidenceMatcher`` satisfies
    it at runtime."""

    def candidates_for_claim(
        self, claim_text: str
    ) -> tuple[ClaimEvidenceCandidate, ...]: ...


@runtime_checkable
class GuardrailScanner(Protocol):
    """Scan a generated artifact through Bedrock Guardrails before Gate #2 (PRD §12.2).

    MUST fail closed: an error or an intervened verdict marks the artifact blocked rather
    than auto-passing (constitution §5/§7). ``BedrockGuardrailScanner`` satisfies it at
    runtime; the unit gate uses ``InMemoryGuardrailScanner``."""

    def scan(self, text: str) -> GuardrailVerdict: ...


@runtime_checkable
class ClaimSink(Protocol):
    """Persist artifact claims + their evidence links (PRD §10.3).

    Claims MUST be inserted before their links (the links FK-reference the claim).
    ``AuroraClaimSink`` satisfies it at runtime."""

    def insert_claim(self, record: ArtifactClaim) -> None: ...

    def link_evidence(self, link: ClaimEvidenceLink) -> None: ...


@runtime_checkable
class ArtifactReviewSink(Protocol):
    """Apply a Gate #2 review status to an artifact row (PRD §10.3 artifacts.status).

    Used by ``persist_artifact_review`` for the graph-side persistence of a rejected/edited
    manifest decision; the per-artifact human approval (and reviewer notes) are recorded by
    the dashboard API in the approvals row. ``AuroraArtifactReviewSink`` satisfies it at
    runtime."""

    def update_artifact_status(self, artifact_id: str, status: str) -> None: ...


class InMemoryClaimEvidenceMatcher:
    """In-process ``ClaimEvidenceMatcher``: returns the candidate set it was seeded with,
    regardless of the claim text, so a test can drive the supported and unsupported
    (no-grounding) paths deterministically."""

    def __init__(self, candidates: tuple[ClaimEvidenceCandidate, ...]) -> None:
        self._candidates = candidates

    def candidates_for_claim(
        self, claim_text: str
    ) -> tuple[ClaimEvidenceCandidate, ...]:
        return self._candidates


class InMemoryGuardrailScanner:
    """In-process ``GuardrailScanner``: returns a preset verdict and records every scanned
    text so a test can assert the artifact body was scanned and that a blocked verdict
    blocks the artifact (no silent bypass)."""

    def __init__(self, verdict: GuardrailVerdict | None = None) -> None:
        self._verdict = verdict or GuardrailVerdict()
        # Newest last — tests inspect what was scanned.
        self.scanned: list[str] = []

    def scan(self, text: str) -> GuardrailVerdict:
        self.scanned.append(text)
        return self._verdict


class InMemoryClaimSink:
    """In-process ``ClaimSink``: records inserted claims + links (in write order) so a test
    can assert claims persist with the right support_status and that each link was recorded
    after its claim (the FK ordering invariant)."""

    def __init__(self) -> None:
        self.claims: list[ArtifactClaim] = []
        self.links: list[ClaimEvidenceLink] = []

    def insert_claim(self, record: ArtifactClaim) -> None:
        self.claims.append(record)

    def link_evidence(self, link: ClaimEvidenceLink) -> None:
        self.links.append(link)


class InMemoryArtifactReviewSink:
    """In-process ``ArtifactReviewSink``: records (artifact_id, status, notes) updates so a
    test can assert a rejected/edited decision was applied and a blocked artifact was never
    advanced to 'approved'."""

    def __init__(self) -> None:
        self.updates: list[tuple[str, str]] = []

    def update_artifact_status(self, artifact_id: str, status: str) -> None:
        self.updates.append((artifact_id, status))
