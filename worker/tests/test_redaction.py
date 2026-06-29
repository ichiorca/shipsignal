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


def test_four_part_version_assignment_is_not_redacted_as_ip() -> None:
    # A 4-part version (all-valid octets) in a version-assignment context is preserved — redacting
    # build metadata like S6_OVERLAY_VERSION=3.2.3.0 is lossy and a personal IP is implausible here.
    result = redact("ARG S6_OVERLAY_VERSION=3.2.3.0")
    assert "3.2.3.0" in result.text
    assert "[redacted-ip]" not in result.text
    assert "ip" not in result.risk_flags


def test_four_part_address_in_non_version_context_is_still_redacted() -> None:
    # The version exception is narrow: a dotted-quad anywhere else is still treated as an IP.
    for line in ("host=10.20.30.40", "connect to 10.20.30.40", "DB_HOST: 10.20.30.40"):
        result = redact(line)
        assert "10.20.30.40" not in result.text, line
        assert "[redacted-ip]" in result.text
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


def test_phone_number_is_redacted_and_flagged() -> None:
    for line in (
        "call +1 (555) 123-4567 for support",
        "ring 555-123-4567 today",
        "intl +44 20 7946 0958",
    ):
        result = redact(line)
        assert "[redacted-phone]" in result.text, line
        assert "phone" in result.risk_flags, line


def test_phone_rule_does_not_eat_version_or_commit_counts() -> None:
    # A 4-segment version (few digits) and a bare separator-less count must survive.
    result = redact("ARG S6_OVERLAY_VERSION=3.2.3.0 over 1234567 commits")
    assert "3.2.3.0" in result.text
    assert "1234567" in result.text
    assert "phone" not in result.risk_flags
    assert "[redacted-phone]" not in result.text


def test_ipv6_is_redacted_and_flagged() -> None:
    for line in (
        "client 2001:0db8:85a3:0000:0000:8a2e:0370:7334 connected",
        "from fe80::1ff:fe23:4567:890a",
        "loopback ::1 hit",
    ):
        result = redact(line)
        assert "[redacted-ip]" in result.text, line
        assert "ip" in result.risk_flags, line


def test_ipv6_rule_does_not_match_host_port_or_clock() -> None:
    # Single-colon prose (host:port, HH:MM:SS) is not an address — must survive.
    result = redact("db:5432 deployed at 12:34:56")
    assert "db:5432" in result.text
    assert "12:34:56" in result.text
    assert "ip" not in result.risk_flags


def test_bare_keyword_no_longer_exempts_a_real_ip() -> None:
    # The version exemption requires an explicit `version`/`revision`/`ver` + `:`/`=`.
    # Bare prose words like "release" must NOT exempt a dotted-quad address.
    for line in ("release 10.0.0.5", "build 10.0.0.5", "tag 10.0.0.5"):
        result = redact(line)
        assert "10.0.0.5" not in result.text, line
        assert "[redacted-ip]" in result.text
        assert "ip" in result.risk_flags


def test_truncated_private_key_block_without_end_is_redacted() -> None:
    # A diff hunk can split a key so the `-----END-----` line is absent — the BEGIN line
    # plus the base64 body must still be stripped (with a leading diff `+` marker).
    truncated = (
        "+-----BEGIN OPENSSH PRIVATE KEY-----\n"
        "+b3BlbnNzaC1rZXktdjEAAAAABG5vbmU\n"
        "+AAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUx\n"
        "+OQAAACDtruncatedhere1234567890abcd\n"
    )
    result = redact(f"leaked key in diff:\n{truncated}context after")

    assert "b3BlbnNzaC1rZXktdjEAAAAABG5vbmU" not in result.text
    assert "[redacted-private-key]" in result.text
    assert "secret:private_key" in result.risk_flags
    # Non-key context survives.
    assert "context after" in result.text


def test_stripe_live_key_is_redacted() -> None:
    # Build the fixture at runtime so the literal token never sits in source
    # (keeps GitHub push-protection / secret scanners from flagging this test).
    stripe_key = "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc"
    result = redact(f"STRIPE_KEY={stripe_key}")

    assert stripe_key not in result.text
    assert "[redacted-secret]" in result.text
    assert "secret:stripe_key" in result.risk_flags


def test_google_api_key_is_redacted() -> None:
    key = "AIza" + "B" * 35
    result = redact(f"maps key {key}")

    assert key not in result.text
    assert "[redacted-secret]" in result.text
    assert "secret:google_api_key" in result.risk_flags


def test_jwt_is_redacted() -> None:
    jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ_signature"
    result = redact(f"session={jwt}")

    assert jwt not in result.text
    assert "[redacted-secret]" in result.text
    assert "secret:jwt" in result.risk_flags


def test_new_patterns_remain_idempotent() -> None:
    stripe_key = "sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc"
    dirty = (
        "call +1 (555) 123-4567 from 2001:db8::1; "
        f"key {stripe_key}"
    )
    once = redact(dirty)
    twice = redact(once.text)

    assert twice.text == once.text
    assert twice.risk_flags == ()
