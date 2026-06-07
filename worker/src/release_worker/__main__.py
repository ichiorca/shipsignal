"""T5 (spec 001) — entry point the GitHub Actions release-run job invokes.

Wires the durable Aurora repository into ``release_intelligence_graph`` and runs the
single pass-through node for one ``release_run_id``. P5 (Safety rails): the run id is
the only externally supplied value and is validated before use; the DB DSN and any
credentials come from env, never argv. On any failure the run is marked ``failed`` so
the dashboard never shows a run wedged in ``running``.

Invoked as ``python -m release_worker --release-run-id <uuid>`` on the runner.
"""

from __future__ import annotations

import argparse
import logging
import sys
from uuid import uuid4

from release_worker.aurora_repository import AuroraReleaseRunRepository
from release_worker.graph import build_release_intelligence_graph
from release_worker.state import ReleaseRunState

logger = logging.getLogger("release_worker")


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="release_worker")
    parser.add_argument(
        "--release-run-id",
        required=True,
        help="UUID of the pre-inserted release_runs row to advance.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    args = _parse_args(sys.argv[1:] if argv is None else argv)
    release_run_id = args.release_run_id

    # The langgraph thread id we persist back to the run (P1: LangGraph owns the
    # thread; the skeleton mints one and records it per the AC).
    thread_id = f"lg_{uuid4().hex}"

    repository = AuroraReleaseRunRepository.from_env()
    try:
        graph = build_release_intelligence_graph(repository)
        initial = ReleaseRunState(release_run_id=release_run_id, thread_id=thread_id)
        graph.invoke(initial)
        logger.info("release run %s completed (thread %s)", release_run_id, thread_id)
        return 0
    except Exception:
        logger.exception("release run %s failed", release_run_id)
        try:
            repository.mark_failed(release_run_id)
        except Exception:
            logger.exception("could not mark release run %s failed", release_run_id)
        return 1
    finally:
        repository.close()


if __name__ == "__main__":
    raise SystemExit(main())
