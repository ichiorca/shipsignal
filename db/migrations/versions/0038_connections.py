"""connections: per-provider OAuth connections with an ENCRYPTED refresh token

Backs the Admin → Connections page: an operator connects a provider (e.g. Google/YouTube) via the
OAuth consent flow and the resulting refresh token is stored here AES-256-GCM-encrypted (ciphertext
+ iv + auth tag), the key held in env (CONNECTIONS_ENCRYPTION_KEY) — never the plaintext token.

DEVIATION NOTE (constitution §4/§5): the constitution prefers secrets in env / AWS Secrets Manager
and forbids plaintext secrets in DB columns. Storing an *encrypted* OAuth refresh token here is a
deliberate, operator-authorized deviation so the connection can be managed from the dashboard. Only
ciphertext lands in the DB (useless without the env key); the plaintext is never logged or sent to
the client. The OAuth *client* id/secret remain app-level env config (NOT stored here).

Single-org tool → one row per provider (UNIQUE(provider)). A disconnect nulls the token columns and
flips status to 'disconnected' (the secret is removed, the row kept for audit). The CHECK enforces
that a 'connected' row always carries its ciphertext (mirrors media_assets' s3_uri CHECK).
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0038_connections"
down_revision: str | None = "0037_media_external_publish"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE connections (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider         TEXT NOT NULL UNIQUE,
            status           TEXT NOT NULL DEFAULT 'connected'
                               CHECK (status IN ('connected', 'disconnected')),
            token_ciphertext TEXT,
            token_iv         TEXT,
            token_tag        TEXT,
            scope            TEXT,
            account_label    TEXT,
            connected_by     TEXT,
            connected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_connections_token_required
                CHECK (status = 'disconnected' OR token_ciphertext IS NOT NULL)
        );
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS connections;")
