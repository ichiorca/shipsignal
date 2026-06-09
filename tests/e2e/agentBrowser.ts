// Shared driver for the browser e2e tests (tests/e2e/*.e2e.ts) over the agent-browser CLI
// (https://github.com/vercel-labs/agent-browser). NOT a test file itself (no *.e2e.ts
// suffix), so the runner imports it but never executes it directly.
//
// agent-browser keeps one persistent headless Chrome across CLI invocations, so the
// sequential calls in a test operate on the same page/session.

import { execFileSync } from 'node:child_process';

export const RUN_E2E = process.env.RUN_E2E === '1';
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const BIN = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';

interface AbResult {
  readonly success: boolean;
  readonly data?: unknown;
  readonly error?: string;
}

/** Run one agent-browser command with --json and return its `data` (throws on failure). */
export function ab(args: readonly string[]): unknown {
  let stdout: string;
  try {
    stdout = execFileSync(BIN, [...args, '--json'], { encoding: 'utf8' });
  } catch (err) {
    // On a non-zero exit the JSON envelope is still on stdout; surface its error.
    const e = err as { stdout?: string; message?: string };
    stdout = e.stdout ?? '';
    if (stdout === '') throw new Error(`agent-browser ${args.join(' ')}: ${e.message ?? 'spawn failed'}`);
  }
  const parsed = JSON.parse(stdout) as AbResult;
  if (!parsed.success) {
    throw new Error(`agent-browser ${args.join(' ')} failed: ${parsed.error ?? 'unknown error'}`);
  }
  return parsed.data;
}

export const abText = (sel: string): string => String(ab(['get', 'text', sel]));
export const abCount = (sel: string): number => Number(ab(['get', 'count', sel]));
export const abVisible = (sel: string): boolean => ab(['is', 'visible', sel]) === true;
export const abEnabled = (sel: string): boolean => ab(['is', 'enabled', sel]) === true;

function agentBrowserAvailable(): boolean {
  try {
    execFileSync(BIN, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** True only when the e2e suite is explicitly enabled AND the CLI is installed. */
export const E2E_ENABLED = RUN_E2E && agentBrowserAvailable();

/** node:test `skip` value: false when enabled, else a human reason. */
export const e2eSkip: string | false = E2E_ENABLED
  ? false
  : RUN_E2E
    ? 'agent-browser not found on PATH (npm i -g agent-browser); set AGENT_BROWSER_BIN to override'
    : 'set RUN_E2E=1 (needs a running dev server + agent-browser) to run browser e2e';

export function closeBrowser(): void {
  try {
    ab(['close']);
  } catch {
    // best-effort browser teardown
  }
}
