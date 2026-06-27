"""Seed the brand brain (voice guide + ICP segments + messaging + a couple voice exemplars) for the
demo, themed for the AGENTIC COMMERCE domain. Idempotent: upserts ICP by slug; refreshes the
singleton voice guide; replaces the demo messaging claims + exemplars.

Env: DATABASE_URL (plain postgresql://, sslmode appended if absent).
"""

from __future__ import annotations

import os

import psycopg

VOICE_GUIDE = {
    "tone": (
        "Confident, concrete, merchant-obsessed. Write like an operator who has run a storefront — "
        "practical and outcome-first, never hype."
    ),
    "reading_level": "Grade 8 — clear to a busy founder or merchant, not just engineers.",
    "do_rules": [
        "Lead with the merchant or shopper outcome (conversion, AOV, fewer abandoned carts)",
        "Name the agentic-commerce capability concretely (discovery, checkout, delegated payment)",
        "Back claims with real numbers or a customer example",
        "Show how it works — tie every benefit to a concrete mechanism",
    ],
    "dont_rules": [
        "No hype or buzzword soup (revolutionary, seamless, next-gen)",
        "No unproven ROI or conversion claims",
        "Don't bury the merchant value under AI jargon",
    ],
    "prefer_terms": [
        "merchant",
        "shopper",
        "checkout",
        "conversion",
        "agent",
        "catalog",
        "AOV",
    ],
    "avoid_terms": [
        "revolutionary",
        "seamless",
        "synergy",
        "cutting-edge",
        "disruptive",
    ],
    "notes": (
        "We sell to commerce teams adopting AI shopping agents for discovery and checkout. Every "
        "claim must trace to a real capability or a customer result."
    ),
}

ICP_SEGMENTS = [
    {
        "id": "seg_dtc_merchant",
        "name": "DTC merchant / founder",
        "description": "Direct-to-consumer brands adding agent-led shopping + checkout to their store.",
        "buyer_roles": ["Founder", "Head of Ecommerce"],
        "pain_points": [
            "High cart abandonment",
            "Low mobile conversion",
            "Manual merchandising",
        ],
        "objections": [
            "Will agents weaken brand control?",
            "How much integration work?",
        ],
        "approved_angles": [
            "Recover abandoned carts with a shopping agent in your brand voice",
            "Agentic checkout lifts conversion without a re-platform",
        ],
    },
    {
        "id": "seg_commerce_platform_eng",
        "name": "Commerce platform engineer",
        "description": "Engineers wiring catalog, payments, and agent protocols into the storefront.",
        "buyer_roles": ["Platform Engineer", "Tech Lead"],
        "pain_points": [
            "Stitching catalog + payments + agent protocols",
            "Fragile checkout integrations",
        ],
        "objections": ["Protocol lock-in", "Security of delegated payments"],
        "approved_angles": [
            "Standards-based integration (ACP / AP2), not a bespoke checkout",
            "Secure delegated payment tokens — no raw card data to the agent",
        ],
    },
    {
        "id": "seg_head_of_growth",
        "name": "Head of Growth / Commerce",
        "description": "Growth leaders chasing conversion lift and new agent-driven demand.",
        "buyer_roles": ["Head of Growth", "VP Commerce"],
        "pain_points": ["Flat conversion", "Rising CAC", "Channel fragmentation"],
        "objections": ["Attribution / ROI proof", "Effort to launch"],
        "approved_angles": [
            "Agent-led discovery expands top-of-funnel demand",
            "Measurable conversion lift, attributable per channel",
        ],
    },
    {
        "id": "seg_marketplace_operator",
        "name": "Marketplace / platform operator",
        "description": "Platforms making many merchants' catalogs agent-ready at scale.",
        "buyer_roles": ["Product Lead", "Partnerships"],
        "pain_points": [
            "Onboarding merchants to agentic checkout",
            "Multi-merchant catalog scale",
        ],
        "objections": ["Scale / reliability", "Merchant adoption"],
        "approved_angles": [
            "One integration makes every merchant's catalog agent-ready",
            "Million-scale agentic catalog across channels",
        ],
    },
]

MESSAGING = [
    (
        "Turn shoppers into buyers with agent-led discovery and checkout — without rebuilding your stack.",
        "positioning",
        ["seg_dtc_merchant", "seg_head_of_growth"],
    ),
    (
        "Standards-based agentic checkout (ACP / AP2) integrates with your existing catalog and payments.",
        "feature_proof",
        ["seg_commerce_platform_eng"],
    ),
    (
        "Secure delegated payments: agents transact with scoped, verifiable mandates — never raw card data.",
        "differentiator",
        ["seg_commerce_platform_eng", "seg_dtc_merchant"],
    ),
    (
        "Recover abandoned carts automatically with a shopping agent that follows up in your brand voice.",
        "feature_proof",
        ["seg_dtc_merchant", "seg_head_of_growth"],
    ),
    (
        "One integration makes your catalog agent-ready across every channel.",
        "positioning",
        ["seg_marketplace_operator"],
    ),
]

EXEMPLARS = [
    (
        "How agentic checkout recovers carts you thought were lost",
        "Most abandoned carts aren't lost intent — they're lost patience. A shopping agent that follows "
        "up in your brand voice, answers the one blocking question, and completes checkout in-thread "
        "turns those carts into orders. No re-platform, no raw card data, just fewer drop-offs.",
        "any",
        "seg_dtc_merchant",
    ),
    (
        "Agent-ready commerce, the standards-based way",
        "You don't need a bespoke checkout for every agent. With ACP and AP2, your catalog and payments "
        "expose a standard surface agents can shop and pay against — with scoped, verifiable payment "
        "mandates instead of card data. One integration, every channel.",
        "any",
        "seg_commerce_platform_eng",
    ),
]


def main() -> int:
    dsn = os.environ["DATABASE_URL"]
    if "sslmode=" not in dsn:
        dsn += ("&" if "?" in dsn else "?") + "sslmode=require"
    conn = psycopg.connect(dsn, autocommit=True)
    with conn.cursor() as cur:
        # 1) Voice guide (singleton, id='default').
        cur.execute(
            "UPDATE voice_guide SET tone=%s, reading_level=%s, do_rules=%s, dont_rules=%s, "
            "prefer_terms=%s, avoid_terms=%s, notes=%s, updated_at=now() WHERE id='default'",
            (
                VOICE_GUIDE["tone"],
                VOICE_GUIDE["reading_level"],
                VOICE_GUIDE["do_rules"],
                VOICE_GUIDE["dont_rules"],
                VOICE_GUIDE["prefer_terms"],
                VOICE_GUIDE["avoid_terms"],
                VOICE_GUIDE["notes"],
            ),
        )
        if (
            cur.rowcount == 0
        ):  # singleton not seeded by migration on this DB — insert it
            cur.execute(
                "INSERT INTO voice_guide (id,tone,reading_level,do_rules,dont_rules,prefer_terms,"
                "avoid_terms,notes) VALUES ('default',%s,%s,%s,%s,%s,%s,%s)",
                (
                    VOICE_GUIDE["tone"],
                    VOICE_GUIDE["reading_level"],
                    VOICE_GUIDE["do_rules"],
                    VOICE_GUIDE["dont_rules"],
                    VOICE_GUIDE["prefer_terms"],
                    VOICE_GUIDE["avoid_terms"],
                    VOICE_GUIDE["notes"],
                ),
            )
        print("voice_guide: set")

        # 2) ICP segments (upsert by slug id).
        for s in ICP_SEGMENTS:
            cur.execute(
                "INSERT INTO icp_segments (id,name,description,buyer_roles,pain_points,objections,"
                "approved_angles,status) VALUES (%s,%s,%s,%s,%s,%s,%s,'active') "
                "ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,"
                "buyer_roles=EXCLUDED.buyer_roles,pain_points=EXCLUDED.pain_points,"
                "objections=EXCLUDED.objections,approved_angles=EXCLUDED.approved_angles,"
                "status='active',updated_at=now()",
                (
                    s["id"],
                    s["name"],
                    s["description"],
                    s["buyer_roles"],
                    s["pain_points"],
                    s["objections"],
                    s["approved_angles"],
                ),
            )
        print(f"icp_segments: {len(ICP_SEGMENTS)} upserted")

        # 3) Messaging claims (replace the demo set).
        cur.execute("DELETE FROM messaging_claims")
        for text, ctype, icp in MESSAGING:
            cur.execute(
                "INSERT INTO messaging_claims (claim_text,claim_type,applies_to_icp,status) "
                "VALUES (%s,%s,%s,'approved')",
                (text, ctype, icp),
            )
        print(f"messaging_claims: {len(MESSAGING)} inserted")

        # 4) Voice exemplars (replace the demo set).
        cur.execute("DELETE FROM company_voice_exemplars")
        for title, body, channel, icp in EXEMPLARS:
            cur.execute(
                "INSERT INTO company_voice_exemplars (title,body_text,channel,icp_segment_id) "
                "VALUES (%s,%s,%s,%s)",
                (title, body, channel, icp),
            )
        print(f"voice_exemplars: {len(EXEMPLARS)} inserted")
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
