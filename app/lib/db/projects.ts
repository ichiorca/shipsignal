// projects / tenants / project_repos repository (migration 0030) — typed, tenant-scoped reads and
// writes for the Projects admin UI and the run-creation flow. All queries are parameterised and
// scoped by tenant_id (the tenancy key — no cross-tenant bleed). constitution §5: `github_secret_id`
// is a Secrets Manager REFERENCE, never the token; it is read server-side only and the client view
// (projectToView) collapses it to a boolean before anything reaches the browser.

import { query, withTransaction, type Queryable } from '@/app/lib/aurora.ts';
import {
  DEFAULT_TENANT_ID,
  slugifyProjectId,
  type Project,
  type ProjectInput,
  type ProjectStatus,
  type Tenant,
} from '@/app/lib/projects.ts';

interface TenantRow {
  id: string;
  name: string;
}

interface ProjectRow {
  id: string;
  tenant_id: string;
  name: string;
  default_base_ref: string;
  default_head_ref: string;
  github_secret_id: string | null;
  status: string;
  repos: string[] | null;
}

const PROJECT_COLUMNS =
  'p.id, p.tenant_id, p.name, p.default_base_ref, p.default_head_ref, p.github_secret_id, p.status';

// Repos are aggregated from the child table in one round-trip (no N+1).
const SELECT_PROJECT = `
  SELECT ${PROJECT_COLUMNS},
         COALESCE(
           array_agg(pr.repo ORDER BY pr.repo) FILTER (WHERE pr.repo IS NOT NULL),
           '{}'
         ) AS repos
    FROM projects p
    LEFT JOIN project_repos pr ON pr.project_id = p.id`;

function asStatus(value: string): ProjectStatus {
  return value === 'archived' ? 'archived' : 'active';
}

function mapRow(row: ProjectRow): Project {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    default_base_ref: row.default_base_ref,
    default_head_ref: row.default_head_ref,
    github_secret_id: row.github_secret_id,
    status: asStatus(row.status),
    repos: row.repos ?? [],
  };
}

export async function listTenants(): Promise<readonly Tenant[]> {
  const result = await query<TenantRow>('SELECT id, name FROM tenants ORDER BY name');
  return result.rows.map((r) => ({ id: r.id, name: r.name }));
}

/** All projects for a tenant (default tenant unless given), most-relevant first, with repos. */
export async function listProjects(
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<readonly Project[]> {
  const result = await query<ProjectRow>(
    `${SELECT_PROJECT}
      WHERE p.tenant_id = $1
      GROUP BY p.id
      ORDER BY p.status, p.name`,
    [tenantId],
  );
  return result.rows.map(mapRow);
}

/** Active projects only — what the run-creation picker offers. */
export async function listActiveProjects(
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<readonly Project[]> {
  const result = await query<ProjectRow>(
    `${SELECT_PROJECT}
      WHERE p.tenant_id = $1 AND p.status = 'active'
      GROUP BY p.id
      ORDER BY p.name`,
    [tenantId],
  );
  return result.rows.map(mapRow);
}

/** One project by id (any tenant), or null. */
export async function getProject(id: string): Promise<Project | null> {
  const result = await query<ProjectRow>(
    `${SELECT_PROJECT} WHERE p.id = $1 GROUP BY p.id`,
    [id],
  );
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

// Replace a project's repo set inside an open transaction (delete-then-insert is simplest and the
// UNIQUE(project_id, repo) constraint keeps it clean; repo counts are tiny).
async function replaceRepos(
  db: Queryable,
  projectId: string,
  repos: readonly string[],
): Promise<void> {
  await db.query('DELETE FROM project_repos WHERE project_id = $1', [projectId]);
  for (const repo of repos) {
    await db.query(
      'INSERT INTO project_repos (project_id, repo) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [projectId, repo],
    );
  }
}

function secretOrNull(input: ProjectInput): string | null {
  const ref = input.github_secret_id?.trim();
  return ref ? ref : null;
}

/** Create (or upsert by derived slug id) a project + its repos, scoped to a tenant. Atomic. */
export async function createProject(
  input: ProjectInput,
  tenantId: string = DEFAULT_TENANT_ID,
): Promise<Project> {
  const id = slugifyProjectId(input.name);
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO projects
         (id, tenant_id, name, default_base_ref, default_head_ref, github_secret_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id, name = EXCLUDED.name,
         default_base_ref = EXCLUDED.default_base_ref, default_head_ref = EXCLUDED.default_head_ref,
         github_secret_id = EXCLUDED.github_secret_id, status = EXCLUDED.status, updated_at = now()`,
      [
        id,
        tenantId,
        input.name,
        input.default_base_ref,
        input.default_head_ref,
        secretOrNull(input),
        input.status,
      ],
    );
    await replaceRepos(client, id, input.repos);
    const result = await client.query<ProjectRow>(
      `${SELECT_PROJECT} WHERE p.id = $1 GROUP BY p.id`,
      [id],
    );
    return mapRow(result.rows[0]!);
  });
}

/** Update an existing project by id + replace its repos. Returns null if it does not exist. */
export async function updateProject(
  id: string,
  input: ProjectInput,
): Promise<Project | null> {
  return withTransaction(async (client) => {
    const updated = await client.query(
      // COALESCE keeps the existing secret reference when the input omits it (blank) — the client
      // never holds the reference (§5: ProjectView has only has_secret), so an edit that doesn't
      // re-enter it must NOT wipe it. Passing a non-empty value replaces it.
      `UPDATE projects SET
         name = $2, default_base_ref = $3, default_head_ref = $4,
         github_secret_id = COALESCE($5, github_secret_id), status = $6, updated_at = now()
       WHERE id = $1`,
      [
        id,
        input.name,
        input.default_base_ref,
        input.default_head_ref,
        secretOrNull(input),
        input.status,
      ],
    );
    if ((updated.rowCount ?? 0) === 0) return null;
    await replaceRepos(client, id, input.repos);
    const result = await client.query<ProjectRow>(
      `${SELECT_PROJECT} WHERE p.id = $1 GROUP BY p.id`,
      [id],
    );
    return mapRow(result.rows[0]!);
  });
}

export async function deleteProject(id: string, db: Queryable = { query }): Promise<void> {
  // project_repos rows CASCADE; release_runs.project_id is SET NULL (history preserved).
  await db.query('DELETE FROM projects WHERE id = $1', [id]);
}
