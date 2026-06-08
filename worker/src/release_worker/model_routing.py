"""T1 (spec 011) — per-node model-tier routing for the Bedrock Converse gateway.

PRD §2.1 (Bedrock Converse model gateway) / §5 (LangGraph routing) and constitution §6
("Cost/latency: no untracked model-tier upgrades"). Every model-invoking graph node is
mapped HERE to an explicit ``ModelTier`` with a documented rationale, and a tier resolves
to a concrete Bedrock model id. This config is the single source of truth for which model
a node runs on: the runtime ``BedrockModelClient`` consults ``resolve_route`` per call
instead of hardcoding one ``modelId``, and the cost-latency eval gate (T4) fails the build
if a node's model id is changed in code without a matching entry here.

Routing policy (constitution §6: "default to the cheapest tier that meets quality"):

* ``CHEAP``    — high-volume, structured, low-creativity work (claim extraction over text we
                 already generated; click-path selector mapping from an approved script).
* ``STANDARD`` — customer-facing reasoning/prose where Haiku under-delivers (feature
                 clustering, artifact generation, skill-revision drafting).
* ``FRONTIER`` — reserved, opt-in via per-tier env override for a node that proves it needs
                 it; nothing routes here by default, so a frontier upgrade is never silent.

Tier→model ids are env-overridable (``BEDROCK_MODEL_TIER_CHEAP`` etc.) so ops can pin or
upgrade a model THROUGH tracked config — never by editing a node's call site. This module
is pure (no boto3 / no I/O) so the unit gate exercises it directly; the runtime client
imports it to pick the model id.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum


class ModelTier(StrEnum):
    """A cost/capability band. ``StrEnum`` so it serializes straight into telemetry rows."""

    CHEAP = "cheap"
    STANDARD = "standard"
    FRONTIER = "frontier"


# Default Bedrock model id per tier. Overridable via env (see ``tier_model_id``) so a model
# upgrade is a config change, not a code change — keeping it inside the §6 "tracked" envelope.
_TIER_ENV_VAR: Mapping[ModelTier, str] = {
    ModelTier.CHEAP: "BEDROCK_MODEL_TIER_CHEAP",
    ModelTier.STANDARD: "BEDROCK_MODEL_TIER_STANDARD",
    ModelTier.FRONTIER: "BEDROCK_MODEL_TIER_FRONTIER",
}

_TIER_DEFAULT_MODEL: Mapping[ModelTier, str] = {
    ModelTier.CHEAP: "anthropic.claude-3-haiku-20240307-v1:0",
    ModelTier.STANDARD: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    ModelTier.FRONTIER: "anthropic.claude-3-opus-20240229-v1:0",
}


@dataclass(frozen=True)
class NodeRoute:
    """The configured tier for one graph node, with the rationale recorded inline."""

    node: str
    tier: ModelTier
    rationale: str


# The canonical node→tier map. Keys are the ``task_name`` each node passes to
# ``generate_json``. Dynamic task names carry a per-item suffix (artifact type, skill name);
# those are keyed by their stable PREFIX and matched by ``resolve_route``.
#
# Constitution §6 — "default to the cheapest tier that meets quality": the rationale on each
# row is the documented justification the eval gate and a reviewer read.
_NODE_ROUTES: tuple[NodeRoute, ...] = (
    NodeRoute(
        node="cluster_features",
        tier=ModelTier.STANDARD,
        rationale=(
            "Clustering noisy, heterogeneous evidence into coherent feature objects needs "
            "real reasoning; Haiku under-clusters and merges distinct features."
        ),
    ),
    NodeRoute(
        node="generate_",
        tier=ModelTier.STANDARD,
        rationale=(
            "Customer-facing artifact prose (blog/changelog/sales/social/demo) is the "
            "product's external voice; Sonnet is the cheapest tier that meets the bar."
        ),
    ),
    NodeRoute(
        node="extract_claims_",
        tier=ModelTier.CHEAP,
        rationale=(
            "Claim extraction is structured decomposition over text we already generated — "
            "high volume, low creativity; Haiku is sufficient and far cheaper."
        ),
    ),
    NodeRoute(
        node="generate_click_path",
        tier=ModelTier.CHEAP,
        rationale=(
            "Mapping an approved demo script onto deterministic selectors is structured and "
            "low-creativity; Haiku keeps demo-media cost down."
        ),
    ),
    NodeRoute(
        node="draft_skill_revision_",
        tier=ModelTier.STANDARD,
        rationale=(
            "Rewriting a SKILL.md from clustered reviewer-edit patterns is careful, "
            "low-volume reasoning; Sonnet over Haiku for fidelity."
        ),
    ),
    NodeRoute(
        # spec 013 T3 — the LLM-as-judge rubric (PRD §17.2 / §12.1 "evaluation rubrics").
        node="evaluate_rubric",
        tier=ModelTier.STANDARD,
        rationale=(
            "Judging marketable-content quality across eight nuanced dimensions is real "
            "evaluative reasoning; Haiku scores too coarsely to be a useful regression "
            "signal, so the judge runs on Sonnet (the cheapest tier that meets the bar)."
        ),
    ),
)


class UnroutedTaskError(KeyError):
    """A ``task_name`` reached the model client with no configured route.

    Raised (not defaulted) so an un-budgeted, un-tiered call can never slip through: a new
    model-invoking node MUST add a ``NodeRoute`` here (constitution §6 — no untracked tier).
    """


def resolve_route(task_name: str) -> NodeRoute:
    """Return the configured route for ``task_name`` (exact key, else longest prefix).

    Longest-prefix wins so a specific key (``generate_click_path``) beats a broader one
    (``generate_``). Raises ``UnroutedTaskError`` when nothing matches — the fail-closed
    default that forces every new node into this config.
    """
    best: NodeRoute | None = None
    for route in _NODE_ROUTES:
        matches = task_name == route.node or task_name.startswith(route.node)
        if matches and (best is None or len(route.node) > len(best.node)):
            best = route
    if best is None:
        raise UnroutedTaskError(task_name)
    return best


def tier_model_id(tier: ModelTier, env: Mapping[str, str] | None = None) -> str:
    """The Bedrock model id for ``tier`` — env override if set, else the tracked default."""
    source = os.environ if env is None else env
    override = source.get(_TIER_ENV_VAR[tier])
    return override if override else _TIER_DEFAULT_MODEL[tier]


def resolve_model(
    task_name: str, env: Mapping[str, str] | None = None
) -> tuple[ModelTier, str]:
    """Resolve ``task_name`` to its (tier, concrete model id) — the routing decision a node
    applies on every Converse call. Raises ``UnroutedTaskError`` for an unknown task."""
    route = resolve_route(task_name)
    return route.tier, tier_model_id(route.tier, env)


def all_routes() -> tuple[NodeRoute, ...]:
    """Every configured route — for the eval gate and docs to enumerate the policy."""
    return _NODE_ROUTES
