"""T3 (spec 002) — AC5: the redaction module has explicit PII/secret tests.

P5 (Safety rails) + domain-gdpr-rules: ``redact`` is the gate that runs BEFORE any
excerpt reaches S3/Aurora/state/Bedrock. These tests exercise the public ``redact``
surface (anti-pattern #4: no private-helper test) with concrete PII/secret fixtures,
prove idempotency (a double-pass can't re-expose data), and assert the risk flags a
reviewer relies on. Coverage of ``redaction.py`` is the AC5 ">=80% on new code" bar.
"""

from __future__ import annotations

from release_worker.redaction import redact


def test_email_is_redacted_and_flagged() -> None:
    result = redact("contact alice.dev@example.co.uk for access")

    assert "alice.dev@example.co.uk" not in result.text
    assert "[redacted-email]" in result.text
    assert "email" in result.risk_flags


def test_ipv4_is_redacted_but_version_string_is_not() -> None:
    result = redact("client 192.168.10.254 hit the API; bumped to v1.2.3")

    assert "192.168.10.254" not in result.text
    assert "[redacted-ip]" in result.text
    # A semver-looking token must survive — the octet bound keeps it from matching.
    assert "v1.2.3" in result.text
    assert "ip" in result.risk_flags


def test_aws_access_key_is_redacted() -> None:
    result = redact("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE")

    assert "AKIAIOSFODNN7EXAMPLE" not in result.text
    assert "secret:aws_access_key" in result.risk_flags


def test_github_token_and_pat_are_redacted() -> None:
    token = "ghp_" + "a" * 36
    pat = "github_pat_" + "b" * 30
    result = redact(f"token={token}\npat={pat}")

    assert token not in result.text
    assert pat not in result.text
    assert "secret:github_token" in result.risk_flags


def test_slack_token_is_redacted() -> None:
    result = redact("slack xoxb-123456789012-abcdef")

    assert "xoxb-123456789012-abcdef" not in result.text
    assert "secret:slack_token" in result.risk_flags


def test_bearer_header_is_redacted_keeping_the_scheme() -> None:
    result = redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig")

    assert "eyJhbGciOiJIUzI1NiJ9.payload.sig" not in result.text
    # The "Bearer" scheme stays so the excerpt is still readable as an auth header.
    assert "Bearer [redacted-secret]" in result.text
    assert "secret:bearer" in result.risk_flags


def test_private_key_block_is_redacted_whole() -> None:
    block = (
        "-----BEGIN RSA PRIVATE KEY-----\n"
        "MIIEowIBAAKCAQEA1234567890\n"
        "abcdefghijklmnopqrstuvwxyz\n"
        "-----END RSA PRIVATE KEY-----"
    )
    result = redact(f"leaked:\n{block}\ndone")

    assert "MIIEowIBAAKCAQEA1234567890" not in result.text
    assert "[redacted-private-key]" in result.text
    assert "secret:private_key" in result.risk_flags


def test_generic_key_value_secret_is_redacted_keeping_field_name() -> None:
    result = redact('api_key = "s3cr3t-value-1234"')

    assert "s3cr3t-value-1234" not in result.text
    # Field name preserved so reviewers know which credential was stripped.
    assert "api_key=[redacted-secret]" in result.text
    assert "secret:credential" in result.risk_flags


def test_crlf_is_normalized_to_lf_and_trailing_ws_stripped() -> None:
    result = redact("line one   \r\nline two\t\r\n")

    assert "\r" not in result.text
    assert result.text == "line one\nline two\n"


def test_clean_text_yields_no_flags_and_is_unchanged_aside_from_normalize() -> None:
    result = redact("just a normal changelog line\n")

    assert result.risk_flags == ()
    assert result.text == "just a normal changelog line\n"


def test_redaction_is_idempotent() -> None:
    dirty = "email me@x.io key=AKIAIOSFODNN7EXAMPLE ip 10.0.0.1"
    once = redact(dirty)
    twice = redact(once.text)

    # A second pass over already-redacted text finds nothing to strip — the
    # placeholders carry no matchable PII/secret, so a double-pass can't re-expose.
    assert twice.text == once.text
    assert twice.risk_flags == ()


def test_multiple_findings_produce_sorted_deduped_flags() -> None:
    result = redact("a@b.com and c@d.com from 1.1.1.1")

    # Two emails collapse to one "email" flag; flags are sorted + de-duplicated.
    assert result.risk_flags == ("email", "ip")
