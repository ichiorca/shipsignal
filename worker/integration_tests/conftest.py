"""Integration tests — run against the REAL local stack (Postgres + LocalStack), not
the in-memory fakes the unit gate uses.

These live OUTSIDE ``testpaths`` (= ``worker/tests``) so the no-infra unit gate
(``pytest -q``) never collects them. Run them explicitly once the stack is up:

    RUN_INTEGRATION=1 pytest worker/integration_tests      # bash / WSL
    $env:RUN_INTEGRATION=1; pytest worker/integration_tests # PowerShell

Without ``RUN_INTEGRATION=1`` every test_*.py here is ignored (so a stray
``pytest worker/integration_tests`` won't fail on a missing database), and the
externally-billed seams (Bedrock / GitHub / ElevenLabs) need their own opt-in flag
on top of that — see each module.
"""

from __future__ import annotations

import os

# Skip collection entirely unless explicitly enabled — also avoids importing boto3 /
# psycopg / langgraph in an environment that doesn't have them (e.g. the CI unit job).
collect_ignore_glob: list[str] = []
if os.environ.get("RUN_INTEGRATION") != "1":
    collect_ignore_glob = ["test_*.py"]
