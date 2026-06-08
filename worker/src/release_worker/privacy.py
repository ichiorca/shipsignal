"""T1/T2/T3 (spec 010) — operator CLI for the GDPR data-subject-rights operations.

The native-launch entry point for the rights ops the constitution makes mandatory
(§5 GDPR rails, §7 escalation): run on the Actions runner, never the Vercel app
(constitution §1). Three subcommands wire the pure logic
(``retention``/``erasure``/``access_export``) to the Aurora+S3 adapters
(``aurora_privacy``):

* ``retention-sweep`` — delete PII-bearing evidence past its retention deadline (Art.5(1)(e)).
* ``erase`` — erase one run's personal data across Aurora + S3, audited + verified (Art.17).
* ``export`` — fulfill a data-subject access request, ONLY with an approved escalation
  (Art.15); the redacted export is written to a server-side file, never streamed to a client.

P5: the log scrubber is installed first so no operation can leak PII to logs/telemetry. Every
externally supplied value is a flag (run id, requester, reason, approver) validated by the
pure layer before use; the DSN / bucket names come from env, never argv.

Invoked as ``python -m release_worker.privacy <subcommand> ...`` on the runner. This module
owns the runtime adapters (psycopg/boto3) so the unit gate never imports it.
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

from release_worker.access_export import ExportApproval, export_subject_data
from release_worker.aurora_evidence import s3_client_from_env
from release_worker.aurora_privacy import (
    AuroraS3ErasureStore,
    AuroraS3ExpiredEvidenceStore,
    AuroraSubjectDataReader,
)
from release_worker.aurora_repository import connect_from_env
from release_worker.erasure import erase_release_run
from release_worker.log_scrubbing import install_pii_scrubbing
from release_worker.retention import sweep_expired_evidence

logger = logging.getLogger("release_worker.privacy")


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="release_worker.privacy")
    sub = parser.add_subparsers(dest="command", required=True)

    sweep = sub.add_parser(
        "retention-sweep",
        help="Delete PII-bearing evidence past its retention deadline (Art.5(1)(e)).",
    )
    sweep.set_defaults(func=_cmd_retention_sweep)

    erase = sub.add_parser(
        "erase",
        help="Erase one run's personal data across Aurora + S3, audited (Art.17).",
    )
    erase.add_argument("--release-run-id", required=True)
    erase.add_argument(
        "--requested-by", required=True, help="Who requested the erasure (audited)."
    )
    erase.add_argument(
        "--reason", required=True, help="Why the data is being erased (audited)."
    )
    erase.set_defaults(func=_cmd_erase)

    export = sub.add_parser(
        "export",
        help="Fulfill a data-subject access export — requires an approved escalation (Art.15).",
    )
    export.add_argument("--release-run-id", required=True)
    export.add_argument(
        "--approved",
        action="store_true",
        help="Required: confirms a human escalation approved fulfillment.",
    )
    export.add_argument(
        "--approver", required=True, help="The human who approved the export."
    )
    export.add_argument(
        "--out",
        required=True,
        help="Server-side file path to write the redacted export JSON (never a client).",
    )
    export.set_defaults(func=_cmd_export)

    return parser.parse_args(argv)


def _cmd_retention_sweep(args: argparse.Namespace) -> int:
    conn = connect_from_env()
    try:
        store = AuroraS3ExpiredEvidenceStore(conn, s3_client_from_env())
        report = sweep_expired_evidence(store)
        logger.info(
            "retention sweep deleted %d row(s), %d S3 object(s)",
            report.rows_deleted,
            report.objects_deleted,
        )
    finally:
        conn.close()
    return 0


def _cmd_erase(args: argparse.Namespace) -> int:
    conn = connect_from_env()
    try:
        store = AuroraS3ErasureStore(
            conn,
            s3_client_from_env(),
            evidence_bucket=_require_env("EVIDENCE_BUCKET"),
            media_bucket=_require_env("MEDIA_BUCKET"),
        )
        report = erase_release_run(
            store,
            args.release_run_id,
            requested_by=args.requested_by,
            reason=args.reason,
        )
        logger.info(
            "erased run %s: %d row(s), %d S3 object(s)",
            report.release_run_id,
            report.rows_deleted,
            report.objects_deleted,
        )
    finally:
        conn.close()
    return 0


def _cmd_export(args: argparse.Namespace) -> int:
    conn = connect_from_env()
    try:
        reader = AuroraSubjectDataReader(conn)
        approval = ExportApproval(approved=args.approved, approver=args.approver)
        export = export_subject_data(reader, args.release_run_id, approval)
        # Redacted records only; write to a server-side file (PII off any client) and log a count.
        Path(args.out).write_text(export.model_dump_json(indent=2), encoding="utf-8")
        logger.info(
            "exported %d record(s) for run %s (approved by %s) to %s",
            len(export.records),
            export.release_run_id,
            export.approved_by,
            args.out,
        )
    finally:
        conn.close()
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    install_pii_scrubbing()
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    try:
        result: int = args.func(args)
        return result
    except Exception:
        logger.exception("privacy command failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
