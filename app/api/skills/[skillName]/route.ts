// T4 (spec 015) — GET /api/skills/{skillName} (PRD §14.4). Read-only: returns one skill's
// active snapshot + its Aurora snapshot history, or 404 if no snapshot exists for that
// name. P5 / constitution §9.2: snapshot metadata only (repo-authored skill text + hashes).
// (The literal `/api/skills/candidates` segment is served by the sibling static route, so
// it never matches this dynamic [skillName].)

import { NextResponse } from 'next/server';
import { getSkillByName } from '@/app/lib/db/skills.ts';
import { resolveOne } from '@/app/lib/readApi.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ skillName: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { skillName } = await context.params;
  const result = await resolveOne(
    () => getSkillByName(skillName),
    'skill not found',
    (skill) => ({ skill }),
  );
  return NextResponse.json(result.body, { status: result.status });
}
