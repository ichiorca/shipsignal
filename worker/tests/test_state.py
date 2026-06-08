"""T5 (spec 001) — unit tests for the Pydantic graph-state model.

P5 (Safety rails): boundary data is validated through the model, so malformed job
input fails fast at the edge rather than flowing into the graph.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from release_worker.state import ReleaseRunState
from release_worker.status import RunStatus


def test_defaults_to_created() -> None:
    state = ReleaseRunState(release_run_id="run-1", thread_id="lg_abc")
    assert state.status is RunStatus.CREATED


def test_is_frozen() -> None:
    state = ReleaseRunState(release_run_id="run-1", thread_id="lg_abc")
    with pytest.raises(ValidationError):
        state.status = RunStatus.COLLECTING_EVIDENCE  # type: ignore[misc]


def test_rejects_empty_identifiers() -> None:
    with pytest.raises(ValidationError):
        ReleaseRunState(release_run_id="", thread_id="lg_abc")
    with pytest.raises(ValidationError):
        ReleaseRunState(release_run_id="run-1", thread_id="")


def test_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        ReleaseRunState(release_run_id="run-1", thread_id="lg_abc", extra="x")  # type: ignore[call-arg]


def test_model_copy_update_status_is_independent() -> None:
    state = ReleaseRunState(release_run_id="run-1", thread_id="lg_abc")
    advanced = state.model_copy(update={"status": RunStatus.COMPLETED})
    assert advanced.status is RunStatus.COMPLETED
    assert state.status is RunStatus.CREATED
