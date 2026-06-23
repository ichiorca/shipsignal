// /projects — pre-configured projects (saved repos + a per-project GitHub credential reference).
// Server Component: reads Aurora server-side and maps every project to the secret-free ProjectView
// before it reaches the client (constitution §5 — no token/ARN in the browser). P6 (WCAG 2.2 AA):
// one <main> landmark; PageHeader title is the page <h1>; the editor is a labelled form island.

import { listProjects } from '@/app/lib/db/projects.ts';
import { projectToView } from '@/app/lib/projects.ts';
import { ProjectsSettings } from '@/app/components/ProjectsSettings.ts';
import { PageHeader } from '@/app/components/PageHeader.ts';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <main id="main">
      <PageHeader
        eyebrow="Settings"
        title="Projects"
        description="Pre-configure repositories and map each to a GitHub credential, so a run can target a saved project instead of typing owner/repo every time."
      />

      <section aria-labelledby="projects-heading">
        <h2 id="projects-heading">Saved repositories &amp; credentials</h2>
        <p>
          Each project bundles one or more repositories with default refs and a GitHub credential.
          The credential is stored in <strong>AWS Secrets Manager</strong> — this screen holds only a{' '}
          <em>reference</em> to it (the token never touches the database or the browser). A project
          with no secret reference falls back to the ambient <code>GITHUB_TOKEN</code>.
        </p>
        <ProjectsSettings projects={projects.map(projectToView)} />
      </section>
    </main>
  );
}
