"""Integration: durable LangGraph resume across SEPARATE checkpointer instances.

This is the whole point of spec 017 (PRD §5.6 "resume the same thread_id"): a graph that
halts at a human gate in one process must resume in a *different* process. We simulate
that by halting with one ``build_checkpointer()`` (a real PostgresSaver over the local
Aurora) and resuming with a brand-new ``build_checkpointer()`` bound to the same thread —
which only works if the checkpoint truly persisted to Postgres, not to in-process memory.
"""

from __future__ import annotations

import os
from typing import TypedDict
from uuid import uuid4

import pytest
from langgraph.graph import END, START, StateGraph
from langgraph.types import Command, interrupt

from release_worker.checkpointer import build_checkpointer, wants_durable_checkpointer


class _State(TypedDict, total=False):
    value: int
    decided: str


def _compile(saver: object) -> object:
    graph: StateGraph = StateGraph(_State)

    def start(_state: _State) -> dict[str, int]:
        return {"value": 1}

    def gate(_state: _State) -> dict[str, str]:
        decision = interrupt("approve?")
        return {"decided": decision}

    def finish(state: _State) -> dict[str, int]:
        return {"value": state["value"] + 1}

    graph.add_node("start", start)
    graph.add_node("gate", gate)
    graph.add_node("finish", finish)
    graph.add_edge(START, "start")
    graph.add_edge("start", "gate")
    graph.add_edge("gate", "finish")
    graph.add_edge("finish", END)
    return graph.compile(checkpointer=saver)


def test_durable_resume_across_separate_savers() -> None:
    if not os.environ.get("DATABASE_URL"):
        pytest.skip("DATABASE_URL not set (bring up the local stack first)")

    # DATABASE_URL present -> the seam selects the durable Postgres saver, not MemorySaver.
    assert wants_durable_checkpointer() is True

    thread = f"it-ckpt-{uuid4().hex}"
    config = {"configurable": {"thread_id": thread}}

    halted = _compile(build_checkpointer()).invoke({}, config)
    assert "__interrupt__" in halted  # blocked at the gate, nothing past it ran

    # A fresh saver from the same DSN stands in for the separate resume invocation.
    resumed = _compile(build_checkpointer()).invoke(Command(resume="approved"), config)
    assert resumed["decided"] == "approved"
    assert resumed["value"] == 2
