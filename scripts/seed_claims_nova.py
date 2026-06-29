"""Populate claim-level provenance for a run: extract claims from each artifact (Bedrock Nova),
link them to evidence via pgvector (Titan claim embeddings), and persist artifact_claims +
claim_evidence_links. Fills the /artifacts/{id}/provenance view for the run.

Bedrock (Nova + Titan) on the ambient AWS profile; Aurora via DATABASE_URL.
Run:  DATABASE_URL=... AWS_REGION=us-east-1 python scripts/seed_claims_nova.py --release-run-id <id>
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path
from uuid import uuid4

import boto3
import psycopg

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "worker" / "src"))

from release_worker.aurora_claims import AuroraClaimSink, AuroraEvidenceMatcher
from release_worker.claim_nodes import (
    extract_claims,
    link_claims_to_evidence,
    persist_claims,
)
from release_worker.content_models import ArtifactDraft


def _extract_json(text: str) -> dict:
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[a-zA-Z]*\n", "", s)
        s = re.sub(r"\n```$", "", s).strip()
    m = re.search(r"\{.*\}", s, re.S)
    if not m:
        raise ValueError("Nova returned no JSON object")
    return json.loads(m.group(0))


class NovaModelClient:
    def __init__(self) -> None:
        self._model = os.environ.get("NOVA_MODEL_ID", "amazon.nova-lite-v1:0")
        self._c = boto3.client(
            "bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1")
        )

    def generate_json(self, task_name, system, messages, schema, idempotency_key):
        sysp = f"{system}\n\nReturn ONLY a JSON object matching this schema (no markdown):\n{json.dumps(schema)}"
        conv = [
            {"role": m["role"], "content": [{"text": m["content"]}]} for m in messages
        ]
        last = None
        for a in range(6):
            try:
                r = self._c.converse(
                    modelId=self._model,
                    system=[{"text": sysp}],
                    messages=conv,
                    inferenceConfig={"maxTokens": 2000, "temperature": 0.0},
                )
                return _extract_json(
                    "".join(
                        b.get("text", "") for b in r["output"]["message"]["content"]
                    )
                )
            except Exception as e:  # noqa: BLE001
                last = e
                if "Throttl" in type(e).__name__ or "Throttl" in str(e):
                    time.sleep(2 + a * 2)
                    continue
                raise
        raise last


def titan_embed(text: str) -> list[float]:
    c = boto3.client(
        "bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1")
    )
    for a in range(6):
        try:
            r = c.invoke_model(
                modelId="amazon.titan-embed-text-v1",
                body=json.dumps({"inputText": text[:40000]}),
            )
            return json.loads(r["body"].read())["embedding"]
        except Exception as e:  # noqa: BLE001
            if "Throttl" in type(e).__name__ or "Throttl" in str(e):
                time.sleep(1 + a)
                continue
            raise
    raise RuntimeError("titan throttled out")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release-run-id", default="3b1fed7f-eba1-487e-8382-0de8c26a33f3")
    args = ap.parse_args()
    dsn = os.environ["DATABASE_URL"]
    if "sslmode=" not in dsn:
        dsn += ("&" if "?" in dsn else "?") + "sslmode=require"
    run = args.release_run_id
    conn = psycopg.connect(dsn, autocommit=True)

    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, feature_id, artifact_type, title, body_markdown, model_id, prompt_version "
            "FROM artifacts WHERE release_run_id=%s",
            (run,),
        )
        rows = cur.fetchall()
    arts = tuple(
        ArtifactDraft(
            artifact_id=str(r[0]),
            release_run_id=run,
            feature_id=(str(r[1]) if r[1] else None),
            artifact_type=r[2],
            title=(r[3] or r[2]),
            body_markdown=(r[4] or "n/a"),
            model_id=(r[5] or "amazon.nova-lite-v1:0"),
            prompt_version=(r[6] or "demo-v1"),
        )
        for r in rows
    )
    print(f"artifacts: {len(arts)}")

    claims = extract_claims(arts, NovaModelClient(), lambda: uuid4().hex)
    print(f"claims extracted: {len(claims)}")
    matcher = AuroraEvidenceMatcher(conn, run, embed_claim=titan_embed)
    claims, links = link_claims_to_evidence(claims, matcher)
    supported = sum(
        1 for c in claims if getattr(c, "support_status", "") == "supported"
    )
    print(
        f"claim->evidence links: {len(links)}  (supported claims: {supported}/{len(claims)})"
    )
    persist_claims(claims, links, AuroraClaimSink(conn))
    print(
        f"DONE: persisted {len(claims)} claims + {len(links)} evidence links for run {run}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
