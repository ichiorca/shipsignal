"""Seed ONE complete end-to-end run for a SECOND repo using REAL Bedrock Nova authoring.

Mirrors ``seed_demo_run.py`` but (a) targets OrcaQubits/agentic-commerce-skills-plugins between two
commits, and (b) replaces the offline ``DemoModelClient`` with a real Amazon Bedrock **Nova** model
client for the LLM authoring (feature clustering + artifact prose). The hermes demo run is untouched —
this inserts a brand-new ``release_run``.

Cross-account by design (account split):
  * **Bedrock (Nova)** uses the AMBIENT/default AWS profile (the account that has Nova quota).
  * **S3** (evidence blobs) uses EXPLICIT shipsignal creds (``SHIPSIGNAL_S3_KEY`` / ``_SECRET``) so it
    writes to the shipsignal evidence bucket regardless of the default profile.
  * **Aurora** uses ``DATABASE_URL`` (Postgres needs no AWS creds).

Env:
  DATABASE_URL              shipsignal Aurora DSN
  GITHUB_TOKEN              for the live compare (private/large repo)
  SHIPSIGNAL_S3_KEY/_SECRET shipsignal S3 credentials (account 897722692550)
  EVIDENCE_BUCKET           shipsignal-evidence-897722692550
  AWS_REGION                us-east-1 (Bedrock + S3)
  NOVA_MODEL_ID             default amazon.nova-lite-v1:0
"""

from __future__ import annotations

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

from release_worker.aurora_content import AuroraArtifactSink, AuroraSkillSnapshotSink
from release_worker.aurora_evidence import S3AuroraEvidenceSink
from release_worker.aurora_features import (
    AuroraFeatureSink,
    AuroraRedactedEvidenceReader,
)
from release_worker.content_models import ApprovedFeature
from release_worker.content_nodes import (
    generate_artifacts_parallel,
    persist_reviewable_artifacts,
    snapshot_active_skills,
)
from release_worker.evidence_models import ReleaseBoundary
from release_worker.evidence_nodes import collect_redact_persist_all
from release_worker.evidence_ports import (
    InMemoryBoundaryReader,
    StaticPullRequestSource,
)
from release_worker.feature_nodes import (
    cluster_features_with_bedrock,
    persist_feature_manifest,
    score_features,
)
from release_worker.github_diff_source import GitHubDiffSource
from release_worker.github_pr_source import GitHubPullRequestSource
from release_worker.repo_skill_source import FilesystemSkillSource

REPO = "OrcaQubits/agentic-commerce-skills-plugins"
BASE = "7473b6a435a47813373baf70f802f2e47587e6d0"  # adding saleor, medusa, salesforce skills
HEAD = "4366f7c11731c9ff07573bef8aa74db9d1ac0aee"  # skill publish
ARTIFACT_TYPES = ("release_blog", "changelog_entry", "linkedin_post", "customer_email")


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
    """Real Bedrock Converse ``ModelClient`` on Amazon Nova (ambient creds). Generic generate_json:
    appends the schema to the system prompt, calls Converse, and extracts the JSON object. Retries on
    throttling. No Guardrail attached (the seed exercises Nova *authoring*; the Guardrail node is a
    separate safety stage)."""

    def __init__(self) -> None:
        self._model = os.environ.get("NOVA_MODEL_ID", "amazon.nova-lite-v1:0")
        self._c = boto3.client(
            "bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1")
        )
        self.calls = 0

    def generate_json(
        self,
        task_name: str,
        system: str,
        messages: list[dict[str, str]],
        schema: dict[str, object],
        idempotency_key: str,
    ) -> dict[str, object]:
        sysprompt = (
            f"{system}\n\nReturn ONLY a JSON object matching this schema "
            f"(no markdown fences, no prose):\n{json.dumps(schema)}"
        )
        conv = [
            {"role": m["role"], "content": [{"text": m["content"]}]} for m in messages
        ]
        last: Exception | None = None
        for attempt in range(6):
            try:
                r = self._c.converse(
                    modelId=self._model,
                    system=[{"text": sysprompt}],
                    messages=conv,
                    inferenceConfig={"maxTokens": 5000, "temperature": 0.0},
                )
                self.calls += 1
                t = "".join(
                    b.get("text", "") for b in r["output"]["message"]["content"]
                )
                return _extract_json(t)
            except Exception as e:  # noqa: BLE001 - seed script: retry throttle, else surface
                last = e
                if "Throttl" in type(e).__name__ or "Throttl" in str(e):
                    time.sleep(2 + attempt * 2)
                    continue
                raise
        raise last if last else RuntimeError("nova call failed")


def _shipsignal_s3():
    return boto3.client(
        "s3",
        region_name=os.environ.get("AWS_REGION", "us-east-1"),
        aws_access_key_id=os.environ["SHIPSIGNAL_S3_KEY"],
        aws_secret_access_key=os.environ["SHIPSIGNAL_S3_SECRET"],
    )


def main() -> int:
    dsn = os.environ["DATABASE_URL"]
    if "sslmode=" not in dsn:
        dsn += ("&" if "?" in dsn else "?") + "sslmode=require"
    ev_bucket = os.environ.get("EVIDENCE_BUCKET", "shipsignal-evidence-897722692550")

    s3 = _shipsignal_s3()
    conn = psycopg.connect(dsn, autocommit=True)
    model = NovaModelClient()
    run_id = str(uuid4())

    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO release_runs (id, repo, base_ref, head_ref, trigger_type, status) "
            "VALUES (%s,%s,%s,%s,'manual','created')",
            (run_id, REPO, BASE, HEAD),
        )
    print(f"run {run_id}  {REPO} {BASE[:8]}...{HEAD[:8]}  (model={model._model})")

    # 1) REAL evidence: live GitHub diff + PRs -> redact -> persist (Aurora + shipsignal S3).
    reader = InMemoryBoundaryReader()
    reader.seed(
        ReleaseBoundary(release_run_id=run_id, repo=REPO, base_ref=BASE, head_ref=HEAD)
    )
    pr_source = (
        GitHubPullRequestSource.from_env()
        if os.environ.get("GITHUB_TOKEN")
        else StaticPullRequestSource({})
    )
    sink = S3AuroraEvidenceSink(conn, s3, ev_bucket)
    records = collect_redact_persist_all(
        run_id, reader, GitHubDiffSource.from_env(), pr_source, sink
    )
    print(f"  evidence: {len(records)} records persisted")

    # 2) REAL Nova clustering -> score -> persist manifest -> approve (Gate #1).
    evidence = AuroraRedactedEvidenceReader(conn).list_redacted_evidence(run_id)
    candidates = cluster_features_with_bedrock(run_id, evidence, model)
    scored = score_features(candidates, evidence)
    feature_sink = AuroraFeatureSink(conn)
    features = persist_feature_manifest(
        run_id, scored, evidence, feature_sink, lambda: uuid4().hex
    )
    for f in features:
        feature_sink.update_status(f.feature_id, "approved", "approved (nova e2e seed)")
    print(f"  features (Nova): {len(features)} persisted + approved")

    # 3) REAL Nova generation: approved features -> artifacts -> persist -> approve (Gate #2).
    approved = tuple(
        ApprovedFeature(
            feature_id=f.feature_id,
            release_run_id=run_id,
            title=f.title,
            summary_internal=f.summary_internal,
            user_value=f.user_value,
            audiences=f.audiences,
            change_type=f.change_type,
            surface_area=f.surface_area,
        )
        for f in features
    )
    snaps = snapshot_active_skills(
        REPO,
        FilesystemSkillSource.from_env().list_skills(),
        AuroraSkillSnapshotSink(conn),
        lambda: uuid4().hex,
    )
    artifacts, events = generate_artifacts_parallel(
        run_id,
        approved,
        snaps,
        model,
        lambda: uuid4().hex,
        model_id=model._model,
        selected_types=ARTIFACT_TYPES,
    )
    persist_reviewable_artifacts(artifacts, events, AuroraArtifactSink(conn))
    with conn.cursor() as cur:
        for a in artifacts:
            cur.execute(
                "UPDATE artifacts SET status='approved' WHERE id=%s", (a.artifact_id,)
            )
    print(
        f"  artifacts (Nova): {len(artifacts)} persisted + approved ({', '.join(ARTIFACT_TYPES)})"
    )

    with conn.cursor() as cur:
        cur.execute(
            "UPDATE release_runs SET status='completed', completed_at=now() WHERE id=%s",
            (run_id,),
        )
    print(f"DONE. run_id={run_id} (status=completed, nova_calls={model.calls})")
    print(f"  dashboard: /releases/{run_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
