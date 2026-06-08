"""T1/T5 (spec 016) — the §18.3 tamper-evident artifact content hash.

Proves the hash is produced for every draft and is STABLE: a pure function of the title + body,
identical across calls/instances, and recomputed (not carried) so it can never drift from an edited
body. The exact digest is asserted against the canonical pre-image so the worker, the dashboard
(``contentHash.ts``), and the SQL backfill (migration 0015) agree byte-for-byte.
"""

from __future__ import annotations

import hashlib

from release_worker.content_hash import artifact_content_hash
from release_worker.content_models import ArtifactDraft

_RUN_ID = "11111111-1111-4111-8111-111111111111"


def _draft(title: str, body: str, artifact_id: str = "a-1") -> ArtifactDraft:
    return ArtifactDraft(
        artifact_id=artifact_id,
        release_run_id=_RUN_ID,
        feature_id=None,
        artifact_type="release_blog",
        title=title,
        body_markdown=body,
        status="draft",
        model_id="bedrock-model-x",
        prompt_version="content-gen-v1",
        skill_versions={},
    )


def test_hash_matches_canonical_pre_image() -> None:
    # title + "\n\n" + body, utf-8, sha256 hex — the contract mirrored in TS + SQL.
    expected = hashlib.sha256(b"Title\n\nBody text").hexdigest()
    assert artifact_content_hash("Title", "Body text") == expected


def test_hash_is_stable_across_calls() -> None:
    a = artifact_content_hash("Release highlights", "We shipped X and Y.")
    b = artifact_content_hash("Release highlights", "We shipped X and Y.")
    assert a == b


def test_none_title_canonicalizes_to_empty_string() -> None:
    assert artifact_content_hash(None, "body") == artifact_content_hash("", "body")


def test_every_draft_exposes_a_stable_content_hash() -> None:
    draft = _draft("Release highlights", "Admins can create checklists.")
    # The computed field is present on the model + its serialization (persisted to the column).
    assert draft.content_hash == artifact_content_hash(
        "Release highlights", "Admins can create checklists."
    )
    assert draft.model_dump()["content_hash"] == draft.content_hash


def test_two_drafts_with_same_content_hash_identically() -> None:
    first = _draft("T", "B", artifact_id="a-1")
    second = _draft("T", "B", artifact_id="a-2")
    # The hash is content-addressed, not row-addressed: same content → same hash.
    assert first.content_hash == second.content_hash


def test_hash_changes_when_body_changes() -> None:
    before = _draft("T", "original body")
    after = before.model_copy(update={"body_markdown": "edited body"})
    # model_copy recomputes the hash from the new content (it can't drift from the body).
    assert after.content_hash != before.content_hash
    assert after.content_hash == artifact_content_hash("T", "edited body")
