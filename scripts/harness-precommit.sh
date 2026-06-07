#!/usr/bin/env sh
# Default PreCommit gate (seeded by `harness adapter add`).
#
# Fires before every agent `git commit` on hook-capable adapters and BLOCKS
# the commit on a non-zero exit. Keep it FAST (~5s budget on claude-code) —
# put full test suites in the spec-kit Stop gate via metadata.testCommand.
#
# Requires the `harness` binary on PATH.
set -eu

# 1. The manifest itself must always be valid CUE.
harness lint

# 2. Add fast project checks below (formatters, linters, blank-stub guards).
#    Examples:
#    ruff check . && mypy
#    gofmt -l . | (! grep .) && go vet ./...
#    test -s memory/constitution.md && ! grep -q TODO memory/constitution.md

echo "[precommit-gate] fast checks passed"
