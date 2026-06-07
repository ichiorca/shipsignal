// T3 (spec 001) — input contract for POST /api/releases (manual compare-range run).
// P5 (Safety rails): treat all inbound request bodies as untrusted; validate at the
// boundary with zod before anything touches Aurora or dispatches an Actions job.

import { z } from 'zod';

// A GitHub "owner/repo" slug. Conservative charset (GitHub's own allowed set) so a
// crafted value can't smuggle a path-traversal or URL-injection payload downstream.
const repoSlug = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, 'expected "owner/repo"');

// A git ref (branch, tag, or SHA). Reject whitespace and the ref-name metacharacters
// git itself forbids; keep it short to bound abuse.
const gitRef = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^\s~^:?*[\\]+$/, 'invalid git ref');

export const createReleaseRunSchema = z
  .object({
    repo: repoSlug,
    base_ref: gitRef,
    head_ref: gitRef,
  })
  .strict(); // reject unknown keys rather than silently dropping them

export type CreateReleaseRunInput = z.infer<typeof createReleaseRunSchema>;

export type ParseResult =
  | { readonly ok: true; readonly value: CreateReleaseRunInput }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Validate an untrusted, already-JSON-parsed request body. Never throws. */
export function parseCreateReleaseRun(body: unknown): ParseResult {
  const result = createReleaseRunSchema.safeParse(body);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  // Flatten to user-safe messages (no internal stack/exception detail leaked).
  const errors = result.error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
  );
  return { ok: false, errors };
}
