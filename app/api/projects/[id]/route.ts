// Thin Vercel route: update / delete one project by id. Validate + delegate; client receives only
// the secret-free ProjectView.

import { NextResponse } from 'next/server';
import { updateProject, deleteProject } from '@/app/lib/db/projects.ts';
import { parseProjectInput, projectToView } from '@/app/lib/projects.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
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
  const project = await updateProject(id, parsed.value);
  if (project === null) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 });
  }
  return NextResponse.json({ project: projectToView(project) });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  await deleteProject(id);
  return NextResponse.json({ deleted: true });
}
