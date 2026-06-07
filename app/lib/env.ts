// T1 (spec 001) — server-only environment accessor.
// P5 (Safety rails): secrets are read from env at call time and never exposed to the
// client. `import 'server-only'` makes any accidental import from a Client Component
// a build-time error, so a secret can't be bundled into the browser.

import 'server-only';

/** Read a required server env var, failing fast with a clear (secret-free) message. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    // The message names the missing var but never echoes any value.
    throw new Error(`missing required environment variable: ${name}`);
  }
  return value;
}

/** Read an optional server env var with a default. */
export function optionalEnv(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}
