"""T2 (spec 001) — Alembic runtime environment.

P5 + aurora-postgresql rules: the database URL comes only from the ``DATABASE_URL``
environment variable (never committed), and TLS is required. Migrations are raw-SQL
DDL (the app uses parameterised raw SQL, not an ORM), so there is no ``target_metadata``
to autogenerate against; the CI "migration check" instead applies and rolls back the
revisions against an ephemeral Postgres to prove they are real and reversible.
"""

from __future__ import annotations

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("missing required environment variable: DATABASE_URL")
    if "sslmode=disable" in url:
        raise RuntimeError("sslmode=disable is forbidden: TLS to Aurora is mandatory")
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=_database_url(),
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section) or {}
    section["sqlalchemy.url"] = _database_url()
    connectable = engine_from_config(
        section,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        # This project uses long, descriptive revision ids (e.g.
        # '0004_feature_manifest_and_approvals' = 35 chars). Alembic would otherwise create
        # ``alembic_version.version_num`` as the default VARCHAR(32) and fail to record any
        # revision id past 32 chars (StringDataRightTruncation). Pre-create the table wide so a
        # fresh DB (local bootstrap, CI ephemeral PG) applies the full chain; on an existing DB
        # this CREATE IF NOT EXISTS is a harmless no-op.
        connection.exec_driver_sql(
            "CREATE TABLE IF NOT EXISTS alembic_version ("
            "version_num VARCHAR(128) NOT NULL "
            "CONSTRAINT alembic_version_pkc PRIMARY KEY)"
        )
        connection.commit()
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
