"""Offline ``ModelClient`` for DEMO_MODE — runs the full pipeline without Amazon Bedrock.

The product's Bedrock access is account-held, so this stand-in lets the whole release→content loop
run end-to-end (clustering → generation → claim extraction) and produce real, persisted artifacts a
judge can see in the dashboard. It implements the SAME ``ModelClient`` port the Bedrock client does,
so swapping it is a single env flag (``DEMO_MODE=1``) — flip it off and the live Bedrock client takes
over with zero code change.

It is honest about being a demo: content is representative, hand-authored per artifact type and
grounded in the REAL evidence it is handed (it cites the actual ``evidence_id``s from the clustering
prompt, so feature→evidence provenance is genuine). It is pure-Python (stdlib only) so it never
imports boto3 and is safe to run anywhere.
"""

from __future__ import annotations

import re

# Headers the clustering node renders for each evidence item: "[<id>] type=<t> file=<path>".
# The id is a UUID/hex (Aurora returns it hyphenated, in-memory it is 32-hex) — allow both.
_EVIDENCE_HEADER = re.compile(
    r"^\[([0-9a-fA-F-]+)\] type=(\S+) file=(.+)$", re.MULTILINE
)


class DemoModelClient:
    """A ``ModelClient`` that returns representative content per task, offline (no Bedrock)."""

    def generate_json(
        self,
        task_name: str,
        system: str,
        messages: list[dict[str, str]],
        schema: dict[str, object],
        idempotency_key: str,
    ) -> dict[str, object]:
        content = messages[0]["content"] if messages else ""
        if task_name == "cluster_features":
            return self._cluster(content)
        if task_name.startswith("generate_"):
            return self._artifact(task_name[len("generate_") :])
        if task_name.startswith("extract_claims_"):
            return self._claims(content)
        if task_name.startswith("draft_skill_revision_"):
            return self._skill_draft(content)
        # Unknown task — return an empty-but-valid shape so validation never crashes the demo.
        if "features" in schema.get("required", []):  # type: ignore[operator]
            return {"features": []}
        if "claims" in schema.get("required", []):  # type: ignore[operator]
            return {"claims": []}
        return {"title": "Update", "body_markdown": "Release update."}

    # --- clustering: cite the REAL evidence ids handed to us -------------------------------------

    def _cluster(self, prompt: str) -> dict[str, object]:
        by_type: dict[str, list[str]] = {}
        for match in _EVIDENCE_HEADER.finditer(prompt):
            by_type.setdefault(match.group(2), []).append(match.group(1))
        ui = by_type.get("ui_string_change", [])
        code = by_type.get("code_diff", [])
        docs = by_type.get("docs_delta", [])
        prs = by_type.get("pr_metadata", [])

        features: list[dict[str, object]] = []
        if code or prs:
            features.append(
                {
                    "title": "Hardened build & CI pipeline",
                    "summary_internal": "Docker build, CI workflows, and release packaging reworked for reliability and reproducibility.",
                    "user_value": "More reliable installs and faster, more trustworthy releases across platforms.",
                    "audiences": ["developer", "devops"],
                    "change_type": "improvement",
                    "surface_area": ["infrastructure", "ci"],
                    "evidence_ids": (code + prs)[:6],
                    "demo_steps_draft": [
                        "Show the green CI run",
                        "Install on a clean machine",
                    ],
                }
            )
        if ui or code:
            features.append(
                {
                    "title": "Smoother runtime adapter & first-run onboarding",
                    "summary_internal": "Runtime provider adapter hardened and in-product onboarding copy refreshed.",
                    "user_value": "New users reach their first successful agent run faster, with clearer prompts.",
                    "audiences": ["end_user", "marketing"],
                    "change_type": "new_feature",
                    "surface_area": ["desktop_app", "onboarding"],
                    "evidence_ids": (ui + code)[:6],
                    "demo_steps_draft": [
                        "Open the app",
                        "Walk the refreshed onboarding",
                    ],
                }
            )
        if docs:
            features.append(
                {
                    "title": "Expanded documentation & setup guides",
                    "summary_internal": "README and docs significantly expanded with setup and usage guidance.",
                    "user_value": "Easier self-serve setup and a clearer path from install to value.",
                    "audiences": ["developer", "end_user"],
                    "change_type": "improvement",
                    "surface_area": ["docs"],
                    "evidence_ids": docs[:5],
                    "demo_steps_draft": [],
                }
            )
        # Guarantee at least one feature linked to real evidence so the manifest is never empty.
        if not features:
            any_ids = next((ids for ids in by_type.values() if ids), [])
            if any_ids:
                features.append(
                    {
                        "title": "Release improvements",
                        "summary_internal": "A set of improvements shipped in this release.",
                        "user_value": "A more reliable, polished product.",
                        "audiences": ["end_user"],
                        "change_type": "improvement",
                        "surface_area": ["product"],
                        "evidence_ids": any_ids[:5],
                        "demo_steps_draft": [],
                    }
                )
        return {"features": features}

    # --- generation: one representative artifact per type ---------------------------------------

    def _artifact(self, artifact_type: str) -> dict[str, object]:
        return _ARTIFACTS.get(artifact_type, _ARTIFACTS["_default"])

    # --- claim extraction: a few defensible claims from the artifact text -----------------------

    # --- skill evolution: a representative SKILL.md body revision from reviewer feedback ----------

    def _skill_draft(self, prompt: str) -> dict[str, object]:
        """Draft a revised skill BODY (no frontmatter) from the current body + feedback themes in
        the prompt, mimicking a Bedrock revision offline. Deterministic: softens superlatives, drops
        unsupported-metric phrasing, preserves the original guidance, and appends a short
        reviewer-informed section so the proposal is a real, reviewable diff of the current body."""
        body = prompt
        if "CURRENT SKILL BODY:" in prompt:
            body = prompt.split("CURRENT SKILL BODY:", 1)[1]
            body = body.split("REVIEWER FEEDBACK THEMES:", 1)[0].strip()
        # The current body is the full SKILL.md (frontmatter + body); strip the leading frontmatter
        # block so the proposal is body-only (the node re-renders frontmatter with the bumped version).
        if body.startswith("---"):
            parts = body.split("---", 2)
            if len(parts) == 3:
                body = parts[2].strip()
        revised = _soften_hype(body)
        addendum = (
            "## Reviewer-informed revisions\n"
            "- Prefer concrete, evidence-backed statements over superlatives.\n"
            "- Do not assert metrics (percentages, multipliers) unless tied to release evidence.\n"
            "- Keep wording tight and on-brand; cut filler."
        )
        proposed_body = f"{revised}\n\n{addendum}\n" if revised else f"{addendum}\n"
        return {
            "proposed_body": proposed_body,
            "proposal_reason": (
                "Address reviewer edits: reduce hype and remove unsupported metric claims "
                "while preserving the skill's original intent."
            ),
        }

    def _claims(self, artifact_text: str) -> dict[str, object]:
        claims = [
            {
                "claim_text": "The release hardens the build and CI pipeline for more reliable installs.",
                "claim_type": "feature_proof",
            },
            {
                "claim_text": "Onboarding copy was refreshed so new users reach their first agent run faster.",
                "claim_type": "feature_proof",
            },
            {
                "claim_text": "Documentation and setup guides were expanded.",
                "claim_type": "feature_proof",
            },
        ]
        return {"claims": claims}


def _md(title: str, body: str) -> dict[str, object]:
    return {"title": title, "body_markdown": body.strip()}


# Superlatives the skill-revision draft softens (case-insensitive whole-word), mapped to a measured
# replacement — the offline stand-in for "reduce hype" reviewer feedback.
_HYPE_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("revolutionary", "notable"),
    ("seamless", "smooth"),
    ("blazing", "fast"),
    ("world-class", "strong"),
    ("game-changing", "meaningful"),
    ("best ever", "useful"),
    ("the best", "a strong"),
    ("incredible", "solid"),
    ("amazing", "useful"),
    ("unbeatable", "competitive"),
)


def _soften_hype(body: str) -> str:
    """Deterministically tone down superlatives in a skill body (the offline 'reduce hype' edit)."""
    revised = body
    for hype, measured in _HYPE_REPLACEMENTS:
        revised = re.sub(
            rf"\b{re.escape(hype)}\b", measured, revised, flags=re.IGNORECASE
        )
    return revised.strip()


# Hand-authored, on-brand artifacts for the Hermes Agent v0.17.0 demo run. Representative content
# (a stand-in for live Bedrock output) — deliberately concrete and grounded in the real diff themes.
_ARTIFACTS: dict[str, dict[str, object]] = {
    "release_blog": _md(
        "Hermes Agent v0.17.0: a sturdier foundation and a smoother first run",
        "## What's new\n\nThis release is about reliability and a better first impression.\n\n"
        "### Hardened build & CI pipeline\nWe reworked the Docker build, CI workflows, and release "
        "packaging so installs are more reproducible and releases are more trustworthy across "
        "platforms.\n\n### Smoother runtime adapter & onboarding\nThe runtime provider adapter is "
        "hardened, and we refreshed the in-product onboarding copy so new users get to their first "
        "successful agent run faster.\n\n### Expanded documentation\nSetup and usage guides got a "
        "meaningful expansion, making self-serve setup easier.\n\n*Upgrade today.*",
    ),
    "changelog_entry": _md(
        "v0.17.0",
        "### Improved\n- Hardened Docker build and CI pipeline for reproducible, reliable releases\n"
        "- Hardened the runtime provider adapter for steadier installs across platforms\n"
        "- Refreshed in-product onboarding copy for a faster first run\n\n### Docs\n- Expanded "
        "README and setup/usage guides",
    ),
    "linkedin_post": _md(
        "Hermes Agent v0.17.0",
        "Hermes Agent v0.17.0 is out. 🚀\n\nThis one's about trust and time-to-value:\n\n"
        "• A hardened build + CI pipeline for reliable, reproducible installs\n"
        "• A steadier runtime adapter across platforms\n"
        "• Refreshed onboarding so you reach your first agent run faster\n\n"
        "Reliability is a feature. Upgrade today.",
    ),
    "x_post": _md(
        "Hermes Agent v0.17.0",
        "Hermes Agent v0.17.0 🚀\n— hardened build + CI for reproducible installs\n"
        "— steadier runtime adapter\n— refreshed onboarding, faster first run\n\nUpgrade today.",
    ),
    "release_audio_digest": _md(
        "Hermes Agent v0.17.0 — audio digest",
        "Hermes Agent version zero point seventeen is here. This release sharpens the build and CI "
        "pipeline, hardens the runtime adapter for more reliable installs across platforms, and "
        "refreshes the in-product onboarding copy so new users get to their first agent run faster. "
        "Documentation and setup guides were expanded too. Reliability is the headline.",
    ),
    "customer_email": _md(
        "Your Hermes Agent just got more reliable — v0.17.0",
        "Hi there,\n\nHermes Agent v0.17.0 is now available. We focused on the things that make "
        "everyday use smoother:\n\n- More reliable installs from a hardened build and CI pipeline\n"
        "- A steadier runtime adapter across platforms\n- A refreshed onboarding flow so getting "
        "started is faster\n\nUpdate when you're ready — it's a drop-in upgrade.\n\n— The Hermes team",
    ),
    "sales_onepager": _md(
        "Hermes Agent v0.17.0 — reliability one-pager",
        "**Value prop:** Hermes Agent v0.17.0 makes deployment and first-run reliable and fast.\n\n"
        "**Use cases:** clean-machine installs, cross-platform rollout, first-time onboarding.\n\n"
        "**What changed:** hardened build/CI, steadier runtime adapter, refreshed onboarding, "
        'expanded docs.\n\n**Talk track:** "Reliability is a feature — fewer failed installs, '
        'faster time-to-first-run."',
    ),
    "battlecard_delta": _md(
        "Battlecard delta — v0.17.0",
        "**Since the prior release:** Hermes now leads with install/runtime reliability and a faster "
        "onboarding path.\n\n**Use when:** a prospect raises setup friction or cross-platform "
        "reliability — point to the hardened build/CI and runtime adapter work in v0.17.0.",
    ),
    "demo_script": _md(
        "Hermes Agent v0.17.0 — 60-second demo",
        "1. Open Hermes on a fresh machine — install completes cleanly (hardened build/CI).\n"
        "2. Launch the app — walk the refreshed onboarding copy.\n"
        "3. Run your first agent task — highlight the steadier runtime adapter.\n"
        "4. Close on: reliable installs, faster first run.",
    ),
    "hackernews_post": _md(
        "Show HN: Hermes Agent v0.17.0 — hardened build/CI and a faster first run",
        "We shipped v0.17.0 focused on reliability: a reworked Docker build and CI pipeline for "
        "reproducible installs, a hardened runtime provider adapter, refreshed onboarding, and "
        "expanded docs. Feedback welcome.",
    ),
    "_default": _md(
        "Hermes Agent v0.17.0",
        "Hermes Agent v0.17.0 hardens the build and runtime and refreshes onboarding for a faster, "
        "more reliable first run.",
    ),
}
