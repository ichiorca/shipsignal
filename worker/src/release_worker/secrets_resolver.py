"""Resolve a project's GitHub credential from AWS Secrets Manager at run time (migration 0030).

constitution §4/§5: the DB stores only a secret REFERENCE (``projects.github_secret_id``, a Secrets
Manager name/ARN); the token itself lives in Secrets Manager and is fetched HERE with the worker's
OIDC-assumed role — never persisted, never logged. boto3 honors ``AWS_ENDPOINT_URL`` / ``AWS_REGION``
ambiently (LocalStack in dev), mirroring ``aurora_evidence.s3_client_from_env``.

The stored secret may be a plain PAT string OR a JSON object ``{"token": "..."}`` (also accepts
``GITHUB_TOKEN``/``github_token`` keys), so an operator can store it either way. ``client`` is
injectable so the unit gate can drive a fake without boto/AWS.
"""

from __future__ import annotations

import json

import boto3
from botocore.exceptions import BotoCoreError, ClientError


class GitHubSecretResolutionError(RuntimeError):
    """Raised when a project's GitHub secret cannot be resolved (message carries NO secret value)."""


def secretsmanager_client_from_env() -> object:
    """A Secrets Manager client; region/endpoint come from the ambient AWS env (LocalStack in dev)."""
    return boto3.client("secretsmanager")


def resolve_github_token(secret_id: str, *, client: object | None = None) -> str:
    """Fetch and extract the GitHub token referenced by ``secret_id``. Fail-fast, secret-free errors."""
    sm = client if client is not None else secretsmanager_client_from_env()
    try:
        response = sm.get_secret_value(SecretId=secret_id)  # type: ignore[attr-defined]
    except (ClientError, BotoCoreError) as err:
        # Never echo the secret value; the id is a reference (name/ARN), safe to name.
        raise GitHubSecretResolutionError(
            f"failed to resolve GitHub secret {secret_id!r}"
        ) from err
    raw = response.get("SecretString")
    if not raw:
        raise GitHubSecretResolutionError(f"secret {secret_id!r} has no SecretString")
    return _extract_token(raw, secret_id)


def _extract_token(raw: str, secret_id: str) -> str:
    raw = raw.strip()
    if raw.startswith("{"):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as err:
            raise GitHubSecretResolutionError(
                f"secret {secret_id!r} is not valid JSON"
            ) from err
        for key in ("token", "GITHUB_TOKEN", "github_token"):
            value = data.get(key)
            if isinstance(value, str) and value:
                return value
        raise GitHubSecretResolutionError(
            f"secret {secret_id!r} JSON has no token field"
        )
    return raw
