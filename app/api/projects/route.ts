// Thin Vercel route (constitution §1): validate + delegate to the projects repo. No model calls,
// no secrets here — the client only ever receives the secret-free ProjectView (projectToView).

import { NextResponse } from 'next/server';
import { listProjects, createProject } from '@/app/lib/db/projects.ts';
import { parseProjectInput, projectToView } from '@/app/lib/projects.ts';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const projects = await listProjects();
  return NextResponse.json({ projects: projects.map(projectToView) });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }
  const parsed = parseProjectInput(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: 'invalid project input', details: parsed.errors },
      { status: 400 },
    );
  }
  const project = await createProject(parsed.value);
  return NextResponse.json({ project: projectToView(project) }, { status: 201 });
}
