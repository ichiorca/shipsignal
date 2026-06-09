"""T2/T3/T4/T5 (spec 006) — the claim/check/Gate-2 nodes of content_generation_graph
(PRD §5.3: extract_claims → link_claims_to_evidence → run_deterministic_policy_checks →
run_bedrock_guardrails → persist → approve_artifacts → persist_artifact_review).

Each node is a pure function of ``(inputs, port)`` — no langgraph/psycopg/boto3 import — so
it is unit-tested through the exact surface the graph invokes (anti-pattern #4). The
constitution's load-bearing rules are enforced *structurally*:

* §5 — model output is untrusted: ``extract_claims`` validates the Bedrock response through
  ``ClaimExtractionResponse`` and normalizes claim_type/risk_level to known enums, so a
  hallucinated value can't smuggle arbitrary text into Aurora.
* §5 — claim-level provenance: ``link_claims_to_evidence`` marks a claim ``SUPPORTED`` only
  when deterministic lexical matching grounds it in >=1 redacted evidence item (and a metric
  claim's figure must literally appear in that evidence), so a fabricated ROI number stays
  ``UNSUPPORTED`` and produces no ``claim_evidence_links`` row.
* §5/§7 — checks are blocking, not advisory-only: an unsupported high-risk claim, an
  unverified metric, a leaked secret, or a Guardrail intervention marks the artifact
  ``blocked`` (Gate #2 cannot approve a blocked artifact) — failures escalate, never auto-pass.
* §5 — no self-approval: ``persist_artifact_review`` applies only rejected/edited decisions;
  the approved path resumes the thread and the per-artifact approval is a recorded human
  action at the dashboard API.

T3 (spec 007): every node here iterates ``state.artifacts`` by content, never by
``artifact_type``, so the four new artifact types (sales one-pager, social post, demo script,
audio digest) flow through extraction → evidence linking → deterministic + Guardrail checks →
Gate #2 on the SAME path as blog/changelog. A demo-script claim is grounded by the identical
evidence-linkage rule — an unlinkable or fabricated-metric demo claim stays UNSUPPORTED and
blocks the artifact, exactly as for any other type (no per-type bypass).
"""

from __future__ import annotations

import hashlib
import logging
import re
from collections.abc import Callable

from pydantic import ValidationError

from release_worker.claim_models import (
    ArtifactClaim,
    ClaimEvidenceLink,
    ClaimExtractionResponse,
    ClaimType,
    FindingSeverity,
    Gate2Payload,
    GuardrailVerdict,
    MalformedClaimOutputError,
    PolicyFinding,
    RiskLevel,
    SupportStatus,
)
from release_worker.claim_ports import (
    ArtifactReviewSink,
    ClaimEvidenceMatcher,
    ClaimSink,
    GuardrailScanner,
)
from release_worker.content_models import ArtifactDraft
from release_worker.content_policy import NamedEntityPolicy, scan_named_entities
from release_worker.feature_models import GateDecision
from release_worker.model_client import ModelClient
from release_worker.redaction import redact

# T3 (spec 016) — the empty/default named-entity policy: no configured codenames/customer names,
# but the pattern-based private-URL / internal-hostname / default-security checks still run.
_DEFAULT_NAMED_POLICY = NamedEntityPolicy()

# Bumped whenever the extraction prompt/template changes so the audit trail (§18.3) records
# which template produced a claim set.
CLAIM_PROMPT_VERSION = "claim-extract-v1"
# Status an artifact carries once a blocking check fires; Gate #2 cannot approve it.
BLOCKED_STATUS = "blocked"
# Deterministic lexical-overlap threshold to ground a claim in an evidence item. Tuned so a
# real capability claim links to its evidence while an incidental single-word overlap does
# not (the metric-subset guard below is the hard anti-fabrication rule).
_SUPPORT_THRESHOLD = 0.34

# --- T2 — claim extraction --------------------------------------------------------

_EXTRACT_SYSTEM = (
    "You decompose a generated release artifact into atomic, checkable claims. For each "
    "factual assertion the artifact makes, emit one claim with its text, a claim_type "
    "(capability | performance | availability | comparison | security | general) and a "
    "risk_level (low | medium | high). Treat any specific metric, percentage, or "
    "comparative superlative as higher risk. Use ONLY the artifact text; do not invent "
    "claims. Return strict JSON matching the provided schema."
)
_EXTRACT_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "claim_text": {"type": "string"},
                    "claim_type": {"type": "string"},
                    "risk_level": {"type": "string"},
                },
                "required": ["claim_text"],
            },
        }
    },
    "required": ["claims"],
}


def _normalize_claim_type(value: str) -> str:
    """Coerce an untrusted model claim_type to a known ``ClaimType`` value (fallback GENERAL)."""
    try:
        return ClaimType(value.strip().lower()).value
    except ValueError:
        return ClaimType.GENERAL.value


def _normalize_risk(value: str) -> str:
    """Coerce an untrusted model risk_level to a known ``RiskLevel`` value (fallback MEDIUM)."""
    try:
        return RiskLevel(value.strip().lower()).value
    except ValueError:
        return RiskLevel.MEDIUM.value


def _extract_idempotency_key(artifact: ArtifactDraft) -> str:
    """Deterministic dedupe key for one extraction call (aws-bedrock-rules: Converse has no
    idempotency of its own). Same artifact id + body → same key, so a retried job neither
    re-bills nor double-extracts."""
    digest = hashlib.sha256()
    digest.update(artifact.artifact_id.encode("utf-8"))
    digest.update(b"\x00")
    digest.update((artifact.title or "").encode("utf-8"))
    digest.update(b"\x00")
    digest.update(artifact.body_markdown.encode("utf-8"))
    return digest.hexdigest()


def extract_claims(
    artifacts: tuple[ArtifactDraft, ...],
    model_client: ModelClient,
    new_claim_id: Callable[[], str],
) -> tuple[ArtifactClaim, ...]:
    """Decompose each artifact into typed claims via Bedrock Converse (T2, PRD §8.3).

    The prompt carries only the (already redacted-derived) artifact title + body. The
    response is validated through ``ClaimExtractionResponse`` (untrusted model output) and a
    malformed payload fails closed as ``MalformedClaimOutputError``. Every claim is minted
    ``support_status='unsupported'`` — grounding is decided by ``link_claims_to_evidence``,
    never by the model (constitution §5). ``new_claim_id`` is injected so the node stays pure.
    """
    claims: list[ArtifactClaim] = []
    for artifact in artifacts:
        prompt = f"{artifact.title or ''}\n\n{artifact.body_markdown}".strip()
        messages = [{"role": "user", "content": prompt}]
        raw = model_client.generate_json(
            f"extract_claims_{artifact.artifact_type}",
            _EXTRACT_SYSTEM,
            messages,
            _EXTRACT_SCHEMA,
            _extract_idempotency_key(artifact),
        )
        try:
            response = ClaimExtractionResponse.model_validate(raw)
        except ValidationError as err:
            raise MalformedClaimOutputError() from err

        for extracted in response.claims:
            claims.append(
                ArtifactClaim(
                    claim_id=new_claim_id(),
                    artifact_id=artifact.artifact_id,
                    claim_text=extracted.claim_text,
                    claim_type=_normalize_claim_type(extracted.claim_type),
                    support_status=SupportStatus.UNSUPPORTED.value,
                    risk_level=_normalize_risk(extracted.risk_level),
                )
            )
    return tuple(claims)


# --- T3 — link claims to evidence (deterministic grounding) -----------------------

# Generic words that carry no grounding signal; dropped before lexical overlap so a shared
# "the"/"now" can't manufacture support.
_STOPWORDS = frozenset(
    {
        "the",
        "a",
        "an",
        "is",
        "are",
        "was",
        "were",
        "be",
        "been",
        "can",
        "now",
        "this",
        "that",
        "to",
        "by",
        "of",
        "and",
        "or",
        "with",
        "for",
        "in",
        "on",
        "at",
        "as",
        "from",
        "your",
        "you",
        "our",
        "we",
        "it",
        "its",
        "will",
        "more",
        "all",
        "any",
        "new",
        "add",
        "added",
        "use",
        "uses",
        "used",
        "via",
        "per",
        "than",
        "into",
    }
)
_WORD = re.compile(r"[a-z0-9]+")
_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _content_tokens(text: str) -> frozenset[str]:
    """Lowercase alpha content tokens (stopwords + pure numbers dropped, light de-pluralize).

    Numbers are handled by ``_numeric_tokens``/the metric-subset guard, not lexical overlap,
    so they are excluded here."""
    tokens: set[str] = set()
    for match in _WORD.findall(text.lower()):
        if match.isdigit() or match in _STOPWORDS:
            continue
        token = match[:-1] if len(match) > 3 and match.endswith("s") else match
        tokens.add(token)
    return frozenset(tokens)


def _numeric_tokens(text: str) -> frozenset[str]:
    """Numeric figures in the text (e.g. ``50`` from ``50%``). A metric claim is grounded
    only if every figure it cites appears in the evidence (the anti-fabrication rule)."""
    return frozenset(_NUMBER.findall(text))


def _lexical_support(claim_text: str, evidence_text: str) -> float:
    """Deterministic support score (0..1): fraction of the claim's content tokens present in
    the evidence excerpt. Reproducible and testable (no model call)."""
    claim_tokens = _content_tokens(claim_text)
    if not claim_tokens:
        return 0.0
    overlap = claim_tokens & _content_tokens(evidence_text)
    return len(overlap) / len(claim_tokens)


def link_claims_to_evidence(
    claims: tuple[ArtifactClaim, ...],
    matcher: ClaimEvidenceMatcher,
    threshold: float = _SUPPORT_THRESHOLD,
) -> tuple[tuple[ArtifactClaim, ...], tuple[ClaimEvidenceLink, ...]]:
    """Ground each claim in evidence and mark unlinkable claims unsupported (T3, PRD §5.3/§11).

    For each claim the matcher surfaces candidate redacted evidence (optionally pgvector-
    ranked); a candidate grounds the claim only if (a) every numeric figure the claim cites
    appears in that candidate (so a fabricated metric is never grounded) and (b) the
    deterministic lexical support score clears ``threshold``. A claim with >=1 grounding link
    becomes ``SUPPORTED`` with its ``evidence_ids`` + per-link ``support_score``; a claim with
    none stays ``UNSUPPORTED`` and produces no link — so it can never be persisted as
    approvable (constitution §5). Returns ``(resolved_claims, links)``.
    """
    resolved: list[ArtifactClaim] = []
    links: list[ClaimEvidenceLink] = []
    for claim in claims:
        claim_numbers = _numeric_tokens(claim.claim_text)
        matched: list[tuple[str, float]] = []
        best = 0.0
        for candidate in matcher.candidates_for_claim(claim.claim_text):
            # A metric claim must cite figures that literally appear in THIS evidence.
            if claim_numbers and not claim_numbers <= _numeric_tokens(
                candidate.redacted_excerpt
            ):
                continue
            score = _lexical_support(claim.claim_text, candidate.redacted_excerpt)
            best = max(best, score)
            if score >= threshold:
                matched.append((candidate.evidence_id, score))

        metadata = {"max_support_score": f"{best:.2f}"}
        if matched:
            for evidence_id, score in matched:
                links.append(
                    ClaimEvidenceLink(
                        claim_id=claim.claim_id,
                        evidence_item_id=evidence_id,
                        support_score=score,
                    )
                )
            resolved.append(
                claim.model_copy(
                    update={
                        "support_status": SupportStatus.SUPPORTED.value,
                        "evidence_ids": tuple(eid for eid, _ in matched),
                        "checker_metadata": metadata,
                    }
                )
            )
        else:
            resolved.append(
                claim.model_copy(
                    update={
                        "support_status": SupportStatus.UNSUPPORTED.value,
                        "checker_metadata": metadata,
                    }
                )
            )
    return tuple(resolved), tuple(links)


# --- T4 — deterministic policy checks + Bedrock Guardrails -------------------------

# Unverifiable superlatives/absolutes (PRD §12.3) — advisory flags, not auto-blocking.
_SUPERLATIVES = re.compile(
    r"(?i)\b(?:best|fastest|cheapest|guaranteed|unlimited|world[- ]class|"
    r"never|always|#1|number one|industry[- ]leading)\b"
)


def _finding(
    artifact_id: str,
    code: str,
    severity: FindingSeverity,
    detail: str,
    claim_id: str | None = None,
) -> PolicyFinding:
    return PolicyFinding(
        artifact_id=artifact_id,
        claim_id=claim_id,
        code=code,
        severity=severity.value,
        detail=detail,
    )


def run_deterministic_policy_checks(
    artifacts: tuple[ArtifactDraft, ...],
    claims: tuple[ArtifactClaim, ...],
    policy: NamedEntityPolicy | None = None,
) -> tuple[PolicyFinding, ...]:
    """Deterministic pre-Guardrail checks over each artifact + its claims (T4 spec 006 / T3 spec 016).

    This is the §18.2 layer-2 (pre-review artifact validation) gate, independent of Bedrock
    Guardrails. Blocking findings (the artifact cannot reach Gate #2 approval):

    * a leaked secret/PII in the body or a claim (reusing the redaction patterns);
    * a named §12.3/§18.1 entity in the body — a codename, customer name, private URL, internal
      hostname, or security-implementation detail (T3, spec 016, project-configurable via ``policy``);
    * an unsupported high-risk claim, and an unsupported metric claim (a cited figure with no
      grounding evidence — the fabricated-ROI case).

    Advisory findings (flag, don't block): unsupported low/medium claims and unverifiable
    superlatives. ``detail`` is user-safe — it never echoes the matched value. ``policy`` carries
    the project-supplied codename/customer/hostname lists; ``None`` runs the pattern-based +
    default-security checks only (the gate is never empty, AC4 — new checks fail closed).
    """
    named_policy = policy if policy is not None else _DEFAULT_NAMED_POLICY
    findings: list[PolicyFinding] = []
    claims_by_artifact: dict[str, list[ArtifactClaim]] = {}
    for claim in claims:
        claims_by_artifact.setdefault(claim.artifact_id, []).append(claim)

    for artifact in artifacts:
        body_flags = redact(artifact.body_markdown).risk_flags
        if body_flags:
            findings.append(
                _finding(
                    artifact.artifact_id,
                    "secret_leak",
                    FindingSeverity.BLOCKING,
                    f"redaction patterns fired in the body: {', '.join(body_flags)}",
                )
            )

        # T3 (spec 016) — named §12.3/§18.1 checks on the publishable body. Each category that
        # fires is a BLOCKING finding so the leak can never reach Gate #2 (fail closed). The
        # detail names only the category code, never the matched codename/customer/host value (§5).
        for code in scan_named_entities(artifact.body_markdown, named_policy):
            findings.append(
                _finding(
                    artifact.artifact_id,
                    code,
                    FindingSeverity.BLOCKING,
                    f"deterministic content check fired: {code}",
                )
            )

        for claim in claims_by_artifact.get(artifact.artifact_id, []):
            claim_flags = redact(claim.claim_text).risk_flags
            if claim_flags:
                findings.append(
                    _finding(
                        artifact.artifact_id,
                        "secret_leak",
                        FindingSeverity.BLOCKING,
                        f"redaction patterns fired in a claim: {', '.join(claim_flags)}",
                        claim_id=claim.claim_id,
                    )
                )

            unsupported = claim.support_status == SupportStatus.UNSUPPORTED.value
            if unsupported and _numeric_tokens(claim.claim_text):
                # A cited metric with no grounding evidence — block (fabricated figure).
                findings.append(
                    _finding(
                        artifact.artifact_id,
                        "unverified_metric",
                        FindingSeverity.BLOCKING,
                        "claim cites a figure not found in any linked evidence",
                        claim_id=claim.claim_id,
                    )
                )
            elif unsupported:
                high = claim.risk_level == RiskLevel.HIGH.value
                findings.append(
                    _finding(
                        artifact.artifact_id,
                        "unsupported_claim",
                        FindingSeverity.BLOCKING if high else FindingSeverity.ADVISORY,
                        "claim has no grounding evidence link",
                        claim_id=claim.claim_id,
                    )
                )

            if _SUPERLATIVES.search(claim.claim_text):
                findings.append(
                    _finding(
                        artifact.artifact_id,
                        "superlative",
                        FindingSeverity.ADVISORY,
                        "claim uses an unverifiable superlative/absolute",
                        claim_id=claim.claim_id,
                    )
                )
    return tuple(findings)


logger = logging.getLogger("release_worker.claims")


def run_bedrock_guardrails(
    artifacts: tuple[ArtifactDraft, ...],
    scanner: GuardrailScanner,
) -> tuple[PolicyFinding, ...]:
    """Scan every artifact body through Bedrock Guardrails before Gate #2 (T4, PRD §12.2).

    A blocked verdict yields a BLOCKING finding so the artifact cannot be approved. The
    scanner is *not* wrapped in a swallow-all: if the Guardrail call itself errors the
    exception propagates and ``__main__`` marks the run failed — a failed run never reaches
    approval, so the safety check still fails closed rather than auto-passing (§5/§7).
    """
    findings: list[PolicyFinding] = []
    for artifact in artifacts:
        verdict: GuardrailVerdict = scanner.scan(artifact.body_markdown)
        if verdict.blocked:
            detail = ", ".join(verdict.categories) or verdict.action
            # Observability: a Guardrail intervention is a safety-rail signal an operator
            # wants to watch. Categories are policy labels (not PII) and the artifact id is an
            # opaque uuid, so this is safe to log (constitution §5 — no prompt/output logged).
            logger.warning(
                "Bedrock Guardrails blocked artifact %s: %s",
                artifact.artifact_id,
                detail,
            )
            findings.append(
                _finding(
                    artifact.artifact_id,
                    "guardrail_blocked",
                    FindingSeverity.BLOCKING,
                    f"Bedrock Guardrails intervened: {detail}",
                )
            )
    return tuple(findings)


def apply_check_outcomes(
    artifacts: tuple[ArtifactDraft, ...],
    findings: tuple[PolicyFinding, ...],
) -> tuple[ArtifactDraft, ...]:
    """Mark every artifact with a BLOCKING finding ``status='blocked'`` (T4).

    Run after both check nodes; the persist node then writes the blocked status so Gate #2
    surfaces the artifact as blocked and the approve API refuses it. Non-blocked artifacts
    keep their ``'draft'`` status."""
    blocked_ids = {
        f.artifact_id for f in findings if f.severity == FindingSeverity.BLOCKING.value
    }
    return tuple(
        artifact.model_copy(update={"status": BLOCKED_STATUS})
        if artifact.artifact_id in blocked_ids
        else artifact
        for artifact in artifacts
    )


# --- T5 — persist claims + Gate #2 interrupt + review -----------------------------


def persist_claims(
    claims: tuple[ArtifactClaim, ...],
    links: tuple[ClaimEvidenceLink, ...],
    sink: ClaimSink,
) -> tuple[str, ...]:
    """Persist artifact_claims + claim_evidence_links (T5, PRD §10.3).

    Claims are inserted before links (the links FK-reference the claim). An unsupported
    claim is still persisted (so the reviewer sees it) but has no link, so it is never an
    *approvable* claim (constitution §5). Returns the inserted claim ids for the audit/log.
    """
    inserted: list[str] = []
    for claim in claims:
        sink.insert_claim(claim)
        inserted.append(claim.claim_id)
    for link in links:
        sink.link_evidence(link)
    return tuple(inserted)


def build_gate2_payload(
    release_run_id: str,
    thread_id: str,
    artifacts: tuple[ArtifactDraft, ...],
    dashboard_base_url: str,
) -> Gate2Payload:
    """Build the JSON payload the Gate #2 interrupt surfaces (T5, PRD §5.6).

    The graph halts here until a human resolves the gate; nothing publishes while artifacts
    are pending. ``blocked_artifacts`` lets the dashboard foreground the artifacts a check
    blocked (those the reviewer must reject/edit, never clean-approve)."""
    base = dashboard_base_url.rstrip("/")
    blocked = sum(1 for a in artifacts if a.status == BLOCKED_STATUS)
    return Gate2Payload(
        release_run_id=release_run_id,
        thread_id=thread_id,
        artifacts_pending_review=len(artifacts),
        blocked_artifacts=blocked,
        dashboard_url=f"{base}/releases/{release_run_id}/artifacts/review",
    )


def route_after_gate2(decision: GateDecision) -> str:
    """Conditional-edge selector after the Gate #2 interrupt (PRD §5.3).

    ``approved`` ends the graph (the per-artifact approval is a recorded human action at the
    dashboard API, which refuses blocked/unsupported artifacts); ``rejected``/``edited`` route
    to ``persist_artifact_review`` so those artifacts are recorded and do not publish."""
    return (
        "approved" if decision is GateDecision.APPROVED else "persist_artifact_review"
    )


def persist_artifact_review(
    decision: GateDecision,
    artifacts: tuple[ArtifactDraft, ...],
    sink: ArtifactReviewSink,
) -> tuple[str, ...]:
    """Apply a recorded Gate #2 rejected/edited decision to the run's artifacts (T5, PRD §5.3).

    Only reached on the non-approved branch (the route keeps approval out of the graph), so
    this never advances an artifact to 'approved' — constitution §5 (no self-approval). The
    per-artifact human approval, and its refusal of blocked/unsupported artifacts, is the
    dashboard API's job. Returns the affected artifact ids for the audit/log.
    """
    affected: list[str] = []
    for artifact in artifacts:
        sink.update_artifact_status(artifact.artifact_id, decision.value)
        affected.append(artifact.artifact_id)
    return tuple(affected)
