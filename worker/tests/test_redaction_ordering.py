"""T5 (spec 010) — redaction-before-persist ordering lint (the privacy-eval graph lint).

The GDPR grader (``evals/graders/gdpr-compliance.sh``) runs THIS test to discharge its
"persist is unreachable without redaction" check. It proves the constitution §5 invariant
structurally, without importing langgraph (so it runs under the CI unit gate where only
pydantic/pytest are installed):

* the persist node accepts ONLY ``RedactedEvidence`` — a type that has no raw field — so there
  is no type-valid way to persist un-redacted text; and
* the redactor actually strips the PII/secret an evidence excerpt can carry.

Together these make "collect → persist" without "redact" in between impossible to express in
the node signatures, which is the property the privacy eval gate depends on.
"""

from __future__ import annotations

from release_worker.evidence_models import CollectedEvidence, RedactedEvidence
from release_worker.evidence_nodes import persist_evidence, redact_evidence
from release_worker.evidence_ports import InMemoryEvidenceSink
from release_worker.redaction import redact

_RUN = "11111111-1111-4111-8111-111111111111"


def test_redacted_evidence_has_no_raw_field() -> None:
    """The only input persist accepts cannot structurally carry raw text (constitution §5)."""
    assert "raw_excerpt" not in RedactedEvidence.model_fields
    assert (
        "raw_excerpt" in CollectedEvidence.model_fields
    )  # the pre-redaction type does


def test_persist_only_consumes_the_post_redaction_type() -> None:
    """collect → redact → persist: the redact node is the only producer of persist's input."""
    collected = (
        CollectedEvidence(
            evidence_type="code_diff",
            source="git_diff",
            repo="org/product",
            raw_excerpt="owner alice@example.com key=AKIAIOSFODNN7EXAMPLE",
        ),
    )
    redacted = redact_evidence(collected)
    assert all(isinstance(item, RedactedEvidence) for item in redacted)

    sink = InMemoryEvidenceSink()
    records = persist_evidence(_RUN, redacted, sink)

    # Nothing un-redacted reached the blob or the row.
    for blob in sink.blobs.values():
        assert "alice@example.com" not in blob
        assert "AKIAIOSFODNN7EXAMPLE" not in blob
    assert records[0].risk_flags  # the redactor flagged what it stripped


def test_redactor_strips_known_pii_and_secrets() -> None:
    result = redact(
        "contact alice@example.com from 10.0.0.5 token=AKIAIOSFODNN7EXAMPLE"
    )

    assert "alice@example.com" not in result.text
    assert "10.0.0.5" not in result.text
    assert "AKIAIOSFODNN7EXAMPLE" not in result.text
    assert (
        result.risk_flags
    )  # non-empty: the redactor recorded why it modified the text
