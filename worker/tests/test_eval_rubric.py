"""T3 (spec 013) — the LLM-as-judge rubric (PRD §17.2) over the ``ModelClient`` seam.

Exercises the rubric through its public surface against the in-memory ``RecordingModelClient``
(no Bedrock): a well-formed judge payload produces an artifact-scoped rubric ``EvalRun`` with
the eight dimensions + an overall mean; a malformed payload fails closed without echoing; the
idempotency key is stable on retry; and a human override is recorded + the score recomputed.
Also asserts the persisted row carries no artifact body (§5).
"""

from __future__ import annotations

import pytest

from release_worker.eval_rubric import (
    ArtifactBody,
    MalformedRubricOutputError,
    RubricDimension,
    apply_human_override,
    score_rubric,
)
from release_worker.model_client import RecordingModelClient

_GOOD_SCORES = {dim.value: 4.0 for dim in RubricDimension}

_ARTIFACT = ArtifactBody(
    artifact_id="art-1",
    artifact_type="release_blog",
    title="What's new",
    body_markdown="We shipped redaction-before-persist.",
)


def test_rubric_scores_all_eight_dimensions_with_overall_mean() -> None:
    client = RecordingModelClient(_GOOD_SCORES)
    run = score_rubric(_ARTIFACT, client, "run-1")
    assert run.eval_type == "rubric"
    assert run.artifact_id == "art-1"
    assert run.release_run_id == "run-1"
    assert set(run.rubric) == {dim.value for dim in RubricDimension}
    assert run.score == 4.0  # mean of all-4 scores
    assert run.findings["human_override"] == "false"


def test_rubric_call_routes_through_the_model_seam_with_a_stable_key() -> None:
    client = RecordingModelClient(_GOOD_SCORES)
    score_rubric(_ARTIFACT, client, "run-1")
    score_rubric(_ARTIFACT, client, "run-1")
    assert len(client.calls) == 2
    # Same artifact → same idempotency key on retry (Converse has no idempotency of its own).
    assert client.calls[0].idempotency_key == client.calls[1].idempotency_key
    # The routing key is prefixed so model_routing tiers it (no untracked tier, §6).
    assert client.calls[0].task_name.startswith("evaluate_rubric")


def test_malformed_judge_output_fails_closed_without_echo() -> None:
    # Missing dimensions / out-of-range → boundary validation rejects, user-safe message.
    client = RecordingModelClient({"clarity": 9.0})
    with pytest.raises(MalformedRubricOutputError) as excinfo:
        score_rubric(_ARTIFACT, client, "run-1")
    # The error must not echo the artifact body or the offending payload.
    assert "redaction-before-persist" not in str(excinfo.value)
    assert "9.0" not in str(excinfo.value)


def test_persisted_rubric_row_carries_no_artifact_body() -> None:
    client = RecordingModelClient(_GOOD_SCORES)
    run = score_rubric(_ARTIFACT, client, "run-1")
    serialized = run.model_dump_json()
    assert "redaction-before-persist" not in serialized
    assert _ARTIFACT.title not in serialized


def test_human_override_is_recorded_and_score_recomputed() -> None:
    client = RecordingModelClient(_GOOD_SCORES)
    run = score_rubric(_ARTIFACT, client, "run-1")
    overridden = apply_human_override(run, {"claim_risk": 2.0}, reviewer="alice")
    assert overridden.rubric["claim_risk"] == 2.0
    # All others stayed at 4.0; mean = (7*4 + 2) / 8 = 3.75.
    assert overridden.score == 3.75
    assert overridden.findings["human_override"] == "true"
    assert overridden.findings["override_reviewer"] == "alice"
    assert overridden.findings["overridden_dimensions"] == "claim_risk"
    # The original run is unmodified (immutable measurement).
    assert run.rubric["claim_risk"] == 4.0


def test_override_rejects_unknown_dimension_and_out_of_range() -> None:
    client = RecordingModelClient(_GOOD_SCORES)
    run = score_rubric(_ARTIFACT, client, "run-1")
    with pytest.raises(ValueError):
        apply_human_override(run, {"not_a_dimension": 3.0}, reviewer="alice")
    with pytest.raises(ValueError):
        apply_human_override(run, {"clarity": 99.0}, reviewer="alice")
