"""T5 (spec 001) / T4 (spec 004) — LangGraph graph state for release_intelligence_graph.

P5 (Safety rails) + stack-python: all boundary data is validated through a Pydantic
v2 model rather than a raw dict, so a malformed job input fails fast at the edge.

Spec 004 extends the skeleton (as its docstring anticipated) with the two fields the
feature-manifest + Gate #1 slice threads between nodes: the persisted ``features`` and
the ``gate_decision`` resolved at the interrupt. Both are redacted/structured data —
only ``FeatureRecord`` (no raw field) ever enters state (constitution §5).
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from release_worker.feature_models import FeatureRecord, GateDecision
from release_worker.status import RunStatus


class ReleaseRunState(BaseModel):
    """State threaded through release_intelligence_graph.

    Carries enough to identify the run and drive its status, plus (spec 004) the feature
    manifest persisted before Gate #1 and the human decision resolved at the gate.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    release_run_id: str = Field(min_length=1)
    thread_id: str = Field(min_length=1)
    status: RunStatus = RunStatus.CREATED
    # Persisted feature manifest (pending_review) the gate surfaces for approval.
    features: tuple[FeatureRecord, ...] = ()
    # Resolved at the Gate #1 interrupt; drives the approved vs reject/edit routing.
    gate_decision: GateDecision | None = None
