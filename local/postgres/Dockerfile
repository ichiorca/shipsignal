# Local-dev only: pgvector + TLS-enabled Postgres.
#
# Why TLS is not optional here (see the app/worker code):
#   * app/lib/aurora.ts sets node-postgres `ssl` whenever PGSSLMODE != 'disable'
#     (and throws on 'disable'). node-postgres has NO plaintext fallback once
#     `ssl` is set — it demands an SSL handshake.
#   * worker/aurora_repository.connect_from_env() forces `sslmode=require`, which
#     also demands SSL.
# So a stock pgvector image (plaintext only) cannot accept these connections.
# A self-signed cert is fine locally: clients only verify the chain under
# PGSSLMODE=verify-full, which we do not use here (we use `require`).
FROM pgvector/pgvector:pg16

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /etc/pg-ssl \
 && openssl req -new -x509 -days 3650 -nodes \
      -subj "/CN=localhost" \
      -keyout /etc/pg-ssl/server.key \
      -out /etc/pg-ssl/server.crt \
 && chown postgres:postgres /etc/pg-ssl/server.key /etc/pg-ssl/server.crt \
 && chmod 600 /etc/pg-ssl/server.key
USER postgres
