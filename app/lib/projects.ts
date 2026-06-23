// Projects domain + input validation (pure: no DB, no 'server-only') so the API routes, the DB
// repo, and the client UI share ONE definition and it's unit-testable under `node --test`.
//
// A Project is a tenant-scoped, pre-configured repo set + a GitHub credential REFERENCE
// (`github_secret_id` = an AWS Secrets Manager name/ARN — NEVER the token; constitution §4/§5).
// The server-side `Project` carries that reference; the client only ever sees `ProjectView`, which
// replaces it with a `has_secret` boolean so neither the token nor the ARN reaches the browser.

import { z } from 'zod';
// Relative (not @/-aliased) so the dependency-free `node --test` loader resolves it; reuse the SAME
// repo/ref validators the release-run input uses (one source of truth).
import { repoSlug, gitRef } from './releaseInput.ts';

export type ProjectStatus = 'active' | 'archived';

/** The seeded org boundary every project defaults to (migration 0030). */
export const DEFAULT_TENANT_ID = 'default';

export interface Tenant {
  readonly id: string;
  readonly name: string;
}

/** Server-side project (carries the secret REFERENCE — never sent to the client). */
export interface Project {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly default_base_ref: string;
  readonly default_head_ref: string;
  /** AWS Secrets Manager name/ARN of the GitHub credential, or null → ambient GITHUB_TOKEN. */
  readonly github_secret_id: string | null;
  readonly status: ProjectStatus;
  readonly repos: readonly string[];
}

/** Client-safe projection: the secret reference is collapsed to a boolean so nothing sensitive
 *  (token OR ARN) crosses to the browser — the UI shows "secret configured" / "ambient token". */
export interface ProjectView {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly default_base_ref: string;
  readonly default_head_ref: string;
  readonly has_secret: boolean;
  readonly status: ProjectStatus;
  readonly repos: readonly string[];
}

export function projectToView(project: Project): ProjectView {
  const { github_secret_id, ...rest } = project;
  return { ...rest, has_secret: github_secret_id !== null && github_secret_id !== '' };
}

/** Derive a stable, human-readable slug id from a project name (mirrors slugifyIcpId). */
export function slugifyProjectId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `proj_${slug || 'unnamed'}`;
}

// A default ref may be blank (no default) OR a valid git ref.
const optionalRef = z.union([z.literal(''), gitRef]).default('');

export const projectInputSchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(120),
    default_base_ref: optionalRef,
    default_head_ref: optionalRef,
    // The Secrets Manager name/ARN (a reference, not the token). Empty/omitted → ambient fallback.
    github_secret_id: z.string().trim().max(512).optional(),
    status: z.enum(['active', 'archived']).default('active'),
    // The repos this project covers; deduped, capped, each a valid owner/repo slug.
    repos: z
      .array(repoSlug)
      .max(20, 'at most 20 repos per project')
      .default([])
      .refine((r) => new Set(r).size === r.length, { message: 'repos must not repeat' }),
  })
  .strict();

export type ProjectInput = z.infer<typeof projectInputSchema>;

export type ParseResult =
  | { readonly ok: true; readonly value: ProjectInput }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Validate an untrusted, already-JSON-parsed project body. Never throws. */
export function parseProjectInput(body: unknown): ParseResult {
  const result = projectInputSchema.safeParse(body);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const errors = result.error.issues.map((issue) =>
    issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
  );
  return { ok: false, errors };
}
