#!/usr/bin/env sh
# Default SessionStart context (seeded by `harness adapter add`).
# Whatever this prints to stdout is injected into the agent's session context.
if [ -f AGENTS.md ]; then
	cat AGENTS.md
fi
if [ -f memory/constitution.md ]; then
	echo
	echo "----- project constitution -----"
	cat memory/constitution.md
fi
exit 0
