"""Run the evaluation stage (deterministic metrics + LLM-as-judge rubric) for one release run,
using real Amazon Bedrock Nova as the judge. Populates `eval_runs` so the dashboard Evaluation
page shows rubric scores. Hermes/other runs untouched.

Bedrock (Nova) uses the ambient/default AWS profile (the Nova-quota account); Aurora uses
DATABASE_URL (no AWS creds). Env: DATABASE_URL, AWS_REGION, NOVA_MODEL_ID (default nova-lite).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import boto3
import psycopg

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT / "worker" / "src"))

from release_worker.aurora_eval import (
    AuroraApprovedArtifactReader,
    AuroraEvalSink,
    AuroraMetricInputsReader,
)
from release_worker.eval_orchestration import run_product_evaluation


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
    """Real Bedrock Converse ModelClient on Amazon Nova (ambient creds), generic generate_json."""

    def __init__(self) -> None:
        self._model = os.environ.get("NOVA_MODEL_ID", "amazon.nova-lite-v1:0")
        self._c = boto3.client(
            "bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1")
        )
        self.calls = 0

    def generate_json(self, task_name, system, messages, schema, idempotency_key):
        sysprompt = (
            f"{system}\n\nReturn ONLY a JSON object matching this schema "
            f"(no markdown fences, no prose):\n{json.dumps(schema)}"
        )
        conv = [
            {"role": m["role"], "content": [{"text": m["content"]}]} for m in messages
        ]
        last = None
        for attempt in range(6):
            try:
                r = self._c.converse(
                    modelId=self._model,
                    system=[{"text": sysprompt}],
                    messages=conv,
                    inferenceConfig={"maxTokens": 2000, "temperature": 0.0},
                )
                self.calls += 1
                t = "".join(
                    b.get("text", "") for b in r["output"]["message"]["content"]
                )
                return _extract_json(t)
            except Exception as e:  # noqa: BLE001
                last = e
                if "Throttl" in type(e).__name__ or "Throttl" in str(e):
                    time.sleep(2 + attempt * 2)
                    continue
                raise
        raise last if last else RuntimeError("nova call failed")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release-run-id", default="3b1fed7f-eba1-487e-8382-0de8c26a33f3")
    args = ap.parse_args()

    dsn = os.environ["DATABASE_URL"]
    if "sslmode=" not in dsn:
        dsn += ("&" if "?" in dsn else "?") + "sslmode=require"
    run = args.release_run_id
    conn = psycopg.connect(dsn, autocommit=True)
    model = NovaModelClient()

    results = run_product_evaluation(
        run,
        AuroraMetricInputsReader(conn, run),
        AuroraApprovedArtifactReader(conn, run),
        model,
        AuroraEvalSink(conn),
    )
    print(f"eval runs recorded: {len(results)} (nova_calls={model.calls})")
    for r in results:
        print(f"  {getattr(r, 'eval_type', '?')}: score={getattr(r, 'score', None)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
