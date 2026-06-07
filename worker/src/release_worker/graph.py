"""T5 (spec 001) — LangGraph wiring for ``release_intelligence_graph``.

P1 (Substrate): orchestration is LangGraph only. This module owns the *graph* (the
single pass-through node and its edges); LangGraph owns state threading, retries, and
(in later specs) interrupts/checkpointing. It imports ``langgraph`` so it is loaded
only by the runtime entry point (``__main__``), never by the unit-test gate.
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from release_worker.nodes import run_passthrough
from release_worker.repository import ReleaseRunRepository
from release_worker.state import ReleaseRunState


def build_release_intelligence_graph(repository: ReleaseRunRepository):
    """Compile the skeleton graph: START -> passthrough -> END.

    The repository is captured in the node closure so the node stays a pure function
    of ``(state, repository)`` while LangGraph only sees a ``state -> state`` callable.
    """

    def _passthrough(state: ReleaseRunState) -> ReleaseRunState:
        return run_passthrough(state, repository)

    graph: StateGraph = StateGraph(ReleaseRunState)
    graph.add_node("passthrough", _passthrough)
    graph.add_edge(START, "passthrough")
    graph.add_edge("passthrough", END)
    return graph.compile()
