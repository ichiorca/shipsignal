"""T1 (spec 011) — per-node model-tier routing (constitution §6: no untracked tier upgrade).

Exercises the public routing surface the runtime ``BedrockModelClient`` calls per Converse
request: every model-invoking node's ``task_name`` resolves to its configured tier + a concrete
model id, dynamic task suffixes (artifact type / skill name) match by prefix, the most specific
key wins, env overrides re-point a tier through tracked config, and an unrouted task FAILS
CLOSED instead of silently defaulting.
"""

from __future__ import annotations

import pytest

from release_worker.model_routing import (
    ModelTier,
    UnroutedTaskError,
    all_routes,
    resolve_model,
    resolve_route,
    tier_model_id,
)


def test_each_known_node_resolves_to_its_configured_tier() -> None:
    # The stable node keys + the tier each is documented to use (constitution §6).
    assert resolve_route("cluster_features").tier is ModelTier.STANDARD
    assert resolve_route("generate_click_path").tier is ModelTier.CHEAP
    assert resolve_route("draft_skill_revision_brand-voice").tier is ModelTier.STANDARD


def test_dynamic_task_names_match_by_prefix() -> None:
    # Content generation + claim extraction carry a per-artifact-type suffix.
    assert resolve_route("generate_release_blog").tier is ModelTier.STANDARD
    assert resolve_route("generate_sales_onepager").tier is ModelTier.STANDARD
    assert resolve_route("extract_claims_release_blog").tier is ModelTier.CHEAP
    assert resolve_route("extract_claims_linkedin_post").tier is ModelTier.CHEAP


def test_longest_prefix_wins_so_click_path_beats_generic_generate() -> None:
    # "generate_click_path" is CHEAP even though "generate_" (STANDARD) also prefixes it.
    route = resolve_route("generate_click_path")
    assert route.node == "generate_click_path"
    assert route.tier is ModelTier.CHEAP


def test_resolve_model_returns_tier_and_concrete_model_id() -> None:
    tier, model_id = resolve_model("cluster_features")
    assert tier is ModelTier.STANDARD
    assert model_id == "anthropic.claude-3-5-sonnet-20241022-v2:0"

    cheap_tier, cheap_model = resolve_model("extract_claims_release_blog")
    assert cheap_tier is ModelTier.CHEAP
    assert cheap_model == "anthropic.claude-3-haiku-20240307-v1:0"


def test_env_override_repoints_a_tier_through_tracked_config() -> None:
    env = {"BEDROCK_MODEL_TIER_CHEAP": "anthropic.claude-3-5-haiku-20241022-v1:0"}
    assert (
        tier_model_id(ModelTier.CHEAP, env)
        == "anthropic.claude-3-5-haiku-20241022-v1:0"
    )
    # An unset override falls back to the tracked default.
    assert tier_model_id(ModelTier.STANDARD, env) == (
        "anthropic.claude-3-5-sonnet-20241022-v2:0"
    )
    _tier, model_id = resolve_model("extract_claims_release_blog", env)
    assert model_id == "anthropic.claude-3-5-haiku-20241022-v1:0"


def test_unrouted_task_fails_closed() -> None:
    # A new model-invoking node with no NodeRoute must raise — never default to a tier.
    with pytest.raises(UnroutedTaskError):
        resolve_route("summarize_everything")
    with pytest.raises(UnroutedTaskError):
        resolve_model("summarize_everything")


def test_every_route_carries_a_nonempty_rationale() -> None:
    # Constitution §6: the documented justification the eval gate + reviewer read.
    routes = all_routes()
    assert routes, "routing table must not be empty"
    for route in routes:
        assert route.rationale.strip(), f"{route.node} has no rationale"
        assert isinstance(route.tier, ModelTier)
