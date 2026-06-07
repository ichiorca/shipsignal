"""T5 (spec 001) — LangGraph graph state for the release-intelligence skeleton.

P5 (Safety rails) + stack-python: all boundary data is validated through a Pydantic
v2 model rather than a raw dict, so a malformed job input fails fast at the edge.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from release_worker.status import RunStatus


class ReleaseRunState(BaseModel):
    """State threaded through the no-op release_intelligence_graph.

    The skeleton carries just enough to identify the run and drive its status; later
    specs extend this with evidence, features, etc.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    release_run_id: str = Field(min_length=1)
    thread_id: str = Field(min_length=1)
    status: RunStatus = RunStatus.QUEUED
