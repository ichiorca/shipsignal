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

from release_worker.evidence_models import (
    CollectedEvidence,
    EvidenceRecord,
    MalformedDiffError,
    RawDiffPayload,
    RedactedEvidence,
    ReleaseBoundary,
)
from release_worker.evidence_ports import BoundaryReader, DiffSource, EvidenceSink
from release_worker.redaction import redact

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


def collect_git_diff(
    boundary: ReleaseBoundary, source: DiffSource
) -> tuple[CollectedEvidence, ...]:
    """Fetch the boundary diff and build one untrusted evidence item per changed file.

    The raw payload is validated through ``RawDiffPayload`` (the single boundary
    check); a malformed payload fails closed as a user-safe ``MalformedDiffError``
    (AC4) without echoing the offending content.
    """
    payload = source.fetch_raw_diff(boundary)
    try:
        diff = RawDiffPayload.model_validate(payload)
    except ValidationError as err:
        # Do not leak the raw payload (may contain PII/secrets) into the error.
        raise MalformedDiffError() from err

    source_url = _compare_url(boundary)
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
                metadata=item.metadata,
            )
        )
    return tuple(out)


def persist_evidence(
    release_run_id: str,
    redacted: tuple[RedactedEvidence, ...],
    sink: EvidenceSink,
) -> tuple[EvidenceRecord, ...]:
    """Upload each redacted full excerpt to S3 and insert its Aurora row (T4).

    Only ``RedactedEvidence`` reaches here, so nothing un-redacted can be persisted.
    The S3 object holds the redacted full excerpt; the row carries the redacted
    summary inline plus the object's URI (AC2/AC3). Raw text is never inlined in
    Aurora and never returned to the caller.
    """
    records: list[EvidenceRecord] = []
    for item in redacted:
        evidence_id = uuid4().hex
        s3_uri = sink.store_blob(release_run_id, evidence_id, item.redacted_excerpt)
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
            metadata=item.metadata,
        )
        sink.record(record)
        records.append(record)
    return tuple(records)


def collect_redact_persist(
    release_run_id: str,
    reader: BoundaryReader,
    source: DiffSource,
    sink: EvidenceSink,
) -> tuple[EvidenceRecord, ...]:
    """Run the four evidence nodes in order for one run (PRD §5.2 sub-chain).

    This is the composition the graph node wraps: load → collect → redact → persist.
    Keeping it as one tested function means the redact-before-persist ordering is
    proven end-to-end against the fakes, independent of langgraph wiring.
    """
    boundary = load_release_boundary(release_run_id, reader)
    collected = collect_git_diff(boundary, source)
    redacted = redact_evidence(collected)
    return persist_evidence(release_run_id, redacted, sink)
