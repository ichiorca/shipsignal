"""Unit tests for secrets_resolver: per-project GitHub token resolution from Secrets Manager.

Drives an injected fake client so the gate needs no AWS/LocalStack. Covers the plain-string and
JSON secret shapes, the fail-fast paths, and that a client error is wrapped without leaking a value.
"""

from __future__ import annotations

import pytest
from botocore.exceptions import ClientError

from release_worker.secrets_resolver import (
    GitHubSecretResolutionError,
    resolve_github_token,
)


class _FakeSecretsManager:
    def __init__(
        self, response: dict | None = None, error: Exception | None = None
    ) -> None:
        self._response = response or {}
        self._error = error

    def get_secret_value(self, SecretId: str) -> dict:  # noqa: N803 - boto kwarg name
        if self._error is not None:
            raise self._error
        return self._response


def test_resolves_a_plain_string_token() -> None:
    client = _FakeSecretsManager({"SecretString": "ghp_plainsecret"})
    assert (
        resolve_github_token("shipsignal/github/acme", client=client)
        == "ghp_plainsecret"
    )


def test_resolves_a_json_token_field() -> None:
    client = _FakeSecretsManager({"SecretString": '{"token": "ghp_jsontoken"}'})
    assert resolve_github_token("acme", client=client) == "ghp_jsontoken"


def test_resolves_a_json_github_token_key() -> None:
    client = _FakeSecretsManager({"SecretString": '{"GITHUB_TOKEN": "ghp_envkey"}'})
    assert resolve_github_token("acme", client=client) == "ghp_envkey"


def test_missing_secret_string_fails_fast() -> None:
    client = _FakeSecretsManager({})
    with pytest.raises(GitHubSecretResolutionError):
        resolve_github_token("acme", client=client)


def test_json_without_a_token_field_fails_fast() -> None:
    client = _FakeSecretsManager({"SecretString": '{"nope": "x"}'})
    with pytest.raises(GitHubSecretResolutionError):
        resolve_github_token("acme", client=client)


def test_client_error_is_wrapped_and_names_only_the_reference() -> None:
    err = ClientError(
        {"Error": {"Code": "ResourceNotFoundException", "Message": "not found"}},
        "GetSecretValue",
    )
    client = _FakeSecretsManager(error=err)
    with pytest.raises(GitHubSecretResolutionError) as exc:
        resolve_github_token("shipsignal/github/missing", client=client)
    # The id is a reference (safe to name); no secret value is involved on this path.
    assert "missing" in str(exc.value)
