"""T2/T3/T4 (spec 002) — the release_intelligence_graph evidence nodes (PRD §5.2).

The first real slice of the graph: ``load_release_boundary`` → ``collect_git_diff`` →
``redact_evidence`` → ``persist_evidence``. Each node is a pure function of
``(inputs, port)`` — no langgraph/psycopg/boto3 import — so it is unit-tested through
the exact surface the graph invokes (anti-pattern #4). The node *signatures* enforce
the constitution's redact-before-persist gate (§5): ``persist_evidence`` only accepts
``RedactedEvidence``/``EvidenceRecord``, which can only come from ``redact_evidence``.

P5 (Safety rails): the diff payload is the untrusted boundary; ``collect_git_diff``
validates it through Pydantic and fails closed with a user-safe error (AC4).
"""

from __future__ import annotations

from uuid import uuid4

from pydantic import ValidationError

from release_worker.embedding_ports import EmbeddingClient
from release_worker.evidence_models import (
    CodeSignal,
    CollectedEvidence,
    EvidenceRecord,
    MalformedDiffError,
    MalformedPullRequestError,
    PullRequestPayload,
    RawDiffPayload,
    RedactedEvidence,
    ReleaseBoundary,
)
from release_worker.evidence_ports import (
    BoundaryReader,
    DiffSource,
    EvidenceSink,
    PullRequestSource,
)
from release_worker.redaction import redact
from release_worker.signal_extractors import CODE_EXTRACTORS, extract_docs_delta

# PRD §6.3: git-diff evidence is typed as a code-diff change from the git_diff source.
_EVIDENCE_TYPE = "code_diff"
_SOURCE = "git_diff"


def load_release_boundary(
    release_run_id: str, reader: BoundaryReader
) -> ReleaseBoundary:
    """Resolve the run's compare range from durable storage (PRD §5.2)."""
    return reader.get_boundary(release_run_id)


def _compare_url(boundary: ReleaseBoundary) -> str:
    """The human-visitable provenance URL for the compare range (AC2 source_url)."""
    return (
        f"https://github.com/{boundary.repo}/compare/"
        f"{boundary.base_ref}...{boundary.head_ref}"
    )


def _validated_diff(boundary: ReleaseBoundary, source: DiffSource) -> RawDiffPayload:
    """Fetch and validate the boundary diff once (the single boundary check, AC4).

    Shared by every diff-derived collector (whole-file evidence, docs deltas, code
    signals) so the compare range is fetched and validated exactly once per run.
    """
    payload = source.fetch_raw_diff(boundary)
    try:
        return RawDiffPayload.model_validate(payload)
    except ValidationError as err:
        # Do not leak the raw payload (may contain PII/secrets) into the error.
        raise MalformedDiffError() from err


def _whole_file_evidence(
    diff: RawDiffPayload, source_url: str
) -> tuple[CollectedEvidence, ...]:
    """One untrusted ``code_diff`` evidence item per changed file (spec 002 behavior)."""
    collected: list[CollectedEvidence] = []
    for changed in diff.files:
        line_ranges = ",".join(h.line_range for h in changed.hunks)
        metadata: dict[str, str | int] = {"status": changed.status}
        if line_ranges:
            metadata["line_range"] = line_ranges
        collected.append(
            CollectedEvidence(
                evidence_type=_EVIDENCE_TYPE,
                source=_SOURCE,
                repo=diff.repo,
                source_url=source_url,
                file_path=changed.file_path,
                raw_excerpt=changed.patch_text,
                metadata=metadata,
            )
        )
    return tuple(collected)


def collect_git_diff(
    boundary: ReleaseBoundary, source: DiffSource
) -> tuple[CollectedEvidence, ...]:
    """Fetch the boundary diff and build one untrusted evidence item per changed file.

    The raw payload is validated through ``RawDiffPayload`` (the single boundary
    check); a malformed payload fails closed as a user-safe ``MalformedDiffError``
    (AC4) without echoing the offending content.
    """
    diff = _validated_diff(boundary, source)
    return _whole_file_evidence(diff, _compare_url(boundary))


def redact_evidence(
    collected: tuple[CollectedEvidence, ...],
) -> tuple[RedactedEvidence, ...]:
    """Redact/normalize every excerpt BEFORE persist (constitution §5).

    Maps each ``CollectedEvidence`` (which carries the raw excerpt) to a
    ``RedactedEvidence`` (which has no raw field), attaching the risk flags the
    redactor raised.
    """
    out: list[RedactedEvidence] = []
    for item in collected:
        result = redact(item.raw_excerpt)
        out.append(
            RedactedEvidence(
                evidence_type=item.evidence_type,
                source=item.source,
                repo=item.repo,
                source_url=item.source_url,
                file_path=item.file_path,
                symbol_name=item.symbol_name,
                redacted_excerpt=result.text,
                risk_flags=result.risk_flags,
                confidence=item.confidence,
                metadata=item.metadata,
            )
        )
    return tuple(out)


def persist_evidence(
    release_run_id: str,
    redacted: tuple[RedactedEvidence, ...],
    sink: EvidenceSink,
    embedder: EmbeddingClient | None = None,
) -> tuple[EvidenceRecord, ...]:
    """Upload each redacted full excerpt to S3 and insert its Aurora row (T4).

    Only ``RedactedEvidence`` reaches here, so nothing un-redacted can be persisted.
    The S3 object holds the redacted full excerpt; the row carries the redacted
    summary inline plus the object's URI (AC2/AC3). Raw text is never inlined in
    Aurora and never returned to the caller.

    T2 (spec 017): when an ``embedder`` is wired, each row also carries the pgvector
    embedding of its (already redacted) excerpt so §11 semantic retrieval has something to
    rank; with no embedder the embedding stays ``None`` and downstream retrieval falls back
    to lexical. The embedding is computed only from ``redacted_excerpt`` — the seam is
    strictly downstream of the redact node (§5), so no raw text reaches the embedding model.
    """
    records: list[EvidenceRecord] = []
    for item in redacted:
        evidence_id = uuid4().hex
        s3_uri = sink.store_blob(release_run_id, evidence_id, item.redacted_excerpt)
        embedding = (
            tuple(embedder.embed(item.redacted_excerpt))
            if embedder is not None
            else None
        )
        record = EvidenceRecord(
            evidence_id=evidence_id,
            release_run_id=release_run_id,
            evidence_type=item.evidence_type,
            source=item.source,
            repo=item.repo,
            source_url=item.source_url,
            file_path=item.file_path,
            symbol_name=item.symbol_name,
            raw_excerpt_s3_uri=s3_uri,
            redacted_excerpt=item.redacted_excerpt,
            risk_flags=item.risk_flags,
            confidence=item.confidence,
            metadata=item.metadata,
            embedding=embedding,
        )
        sink.record(record)
        records.append(record)
    return tuple(records)


def collect_redact_persist(
    release_run_id: str,
    reader: BoundaryReader,
    source: DiffSource,
    sink: EvidenceSink,
    embedder: EmbeddingClient | None = None,
) -> tuple[EvidenceRecord, ...]:
    """Run the four evidence nodes in order for one run (PRD §5.2 sub-chain).

    This is the composition the graph node wraps: load → collect → redact → persist.
    Keeping it as one tested function means the redact-before-persist ordering is
    proven end-to-end against the fakes, independent of langgraph wiring. ``embedder``
    (T2, spec 017) is threaded to persist so embeddings are computed post-redaction.
    """
    boundary = load_release_boundary(release_run_id, reader)
    collected = collect_git_diff(boundary, source)
    redacted = redact_evidence(collected)
    return persist_evidence(release_run_id, redacted, sink, embedder)


# --- T1 (spec 003) — collect_prs_and_issues ---------------------------------------
# PR/issue text is untrusted (github-rules) and is emitted as raw CollectedEvidence;
# it still passes redact_evidence before any persist (§5). Provenance is direct, so
# these collector items carry confidence=1.0 (nothing is inferred to discount).
_PR_SOURCE = "pr_metadata"
_PR_EVIDENCE_TYPE = "pr_metadata"
_ISSUE_SOURCE = "issue_tracker"
_ISSUE_EVIDENCE_TYPE = "issue"
_DIRECT_PROVENANCE_CONFIDENCE = 1.0


def collect_prs_and_issues(
    boundary: ReleaseBoundary, source: PullRequestSource
) -> tuple[CollectedEvidence, ...]:
    """Fetch PR metadata + linked issues and emit one untrusted evidence item each (T1).

    The source payload is validated through ``PullRequestPayload`` (the single boundary
    check); a malformed payload fails closed as a user-safe ``MalformedPullRequestError``
    (AC4) without echoing the offending content. Title/body are kept verbatim here —
    redaction happens in ``redact_evidence`` before persist (§5).
    """
    payload = source.fetch_pull_requests(boundary)
    try:
        prs = PullRequestPayload.model_validate(payload)
    except ValidationError as err:
        raise MalformedPullRequestError() from err

    collected: list[CollectedEvidence] = []
    for pr in prs.pull_requests:
        pr_metadata: dict[str, str | int] = {"pr_number": pr.number}
        if pr.labels:
            pr_metadata["labels"] = ",".join(pr.labels)
        if pr.reviewers:
            pr_metadata["reviewers"] = ",".join(pr.reviewers)
        collected.append(
            CollectedEvidence(
                evidence_type=_PR_EVIDENCE_TYPE,
                source=_PR_SOURCE,
                repo=boundary.repo,
                source_url=pr.url,
                raw_excerpt=f"{pr.title}\n\n{pr.body}".strip(),
                confidence=_DIRECT_PROVENANCE_CONFIDENCE,
                metadata=pr_metadata,
            )
        )
        for issue in pr.linked_issues:
            collected.append(
                CollectedEvidence(
                    evidence_type=_ISSUE_EVIDENCE_TYPE,
                    source=_ISSUE_SOURCE,
                    repo=boundary.repo,
                    source_url=issue.url,
                    raw_excerpt=f"{issue.title}\n\n{issue.body}".strip(),
                    confidence=_DIRECT_PROVENANCE_CONFIDENCE,
                    metadata={"pr_number": pr.number, "issue_key": issue.key},
                )
            )
    return tuple(collected)


# --- T2/T4 (spec 003) — diff-derived signal collection ----------------------------


def _signal_to_evidence(
    diff: RawDiffPayload, source_url: str, file_path: str, status: str, sig: CodeSignal
) -> CollectedEvidence:
    """Lift a deterministic ``CodeSignal`` into a ``CollectedEvidence`` (shared by the
    docs and code-signal nodes), adding repo/source_url/file_path provenance and the
    new-file line range. ``source="git_diff"`` matches the PRD §6.3 contract example."""
    metadata: dict[str, str | int] = {"status": status}
    if sig.line is not None:
        metadata["line_range"] = str(sig.line)
    return CollectedEvidence(
        evidence_type=sig.evidence_type,
        source=_SOURCE,
        repo=diff.repo,
        source_url=source_url,
        file_path=file_path,
        symbol_name=sig.symbol_name,
        raw_excerpt=sig.excerpt,
        confidence=sig.confidence,
        metadata=metadata,
    )


def collect_docs_changes(
    diff: RawDiffPayload, source_url: str
) -> tuple[CollectedEvidence, ...]:
    """Detect docs/release-note/API-reference deltas in the diff as evidence (T2).

    Drives the ``extract_docs_delta`` extractor over every changed file so that
    extractor is reachable through exactly one node (anti-pattern #3).
    """
    collected: list[CollectedEvidence] = []
    for changed in diff.files:
        for sig in extract_docs_delta(changed):
            collected.append(
                _signal_to_evidence(
                    diff, source_url, changed.file_path, changed.status, sig
                )
            )
    return tuple(collected)


def extract_code_signals(
    diff: RawDiffPayload, source_url: str
) -> tuple[CollectedEvidence, ...]:
    """Run the deterministic code-signal extractors over every changed file (T4).

    Each extractor (§6.2) emits typed ``CodeSignal``s which become typed
    ``CollectedEvidence`` carrying ``evidence_type`` + ``confidence`` + provenance.
    """
    collected: list[CollectedEvidence] = []
    for changed in diff.files:
        for extractor in CODE_EXTRACTORS:
            for sig in extractor(changed):
                collected.append(
                    _signal_to_evidence(
                        diff, source_url, changed.file_path, changed.status, sig
                    )
                )
    return tuple(collected)


def collect_redact_persist_all(
    release_run_id: str,
    reader: BoundaryReader,
    diff_source: DiffSource,
    pr_source: PullRequestSource,
    sink: EvidenceSink,
    embedder: EmbeddingClient | None = None,
) -> tuple[EvidenceRecord, ...]:
    """The full release-intelligence collection chain for one run (PRD §5.2, T4).

    Order mirrors the graph: load_release_boundary → collect_git_diff →
    collect_prs_and_issues → collect_docs_changes → extract_code_signals →
    redact_evidence → persist_evidence. Every raw collector item is accumulated in
    *local* scope and redacted before persist — raw excerpts never enter LangGraph
    state, Aurora, or S3 (constitution §5 "redact before persist, before state"). The
    diff is fetched and validated exactly once and reused across the diff-derived nodes.

    T2 (spec 017): ``embedder`` is threaded to persist so each redacted row also carries a
    pgvector embedding for §11 semantic retrieval (``None`` ⇒ lexical fallback downstream).
    The embedding is derived from the redacted excerpt only, so it stays downstream of the
    redact gate (§5).
    """
    boundary = load_release_boundary(release_run_id, reader)
    source_url = _compare_url(boundary)
    diff = _validated_diff(boundary, diff_source)

    collected: tuple[CollectedEvidence, ...] = (
        *_whole_file_evidence(diff, source_url),
        *collect_prs_and_issues(boundary, pr_source),
        *collect_docs_changes(diff, source_url),
        *extract_code_signals(diff, source_url),
    )
    redacted = redact_evidence(collected)
    return persist_evidence(release_run_id, redacted, sink, embedder)
