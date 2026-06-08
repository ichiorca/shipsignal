// T4 (spec 015) — GET /api/skills/candidates/{candidateId} (PRD §14.4). Read-only:
// returns one skill-revision candidate with its current/proposed SKILL.md body and
// supporting signals (the Gate #3 / admin detail payload), or 404. P5 / constitution
// §5/§9.4: a read of a staged proposal — never writes the repo file or promotes.

import { NextResponse } from 'next/server';
import { getSkillCandidate } from '@/app/lib/db/skillCandidates.ts';
import { resolveOne } from '@/app/lib/readApi.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ candidateId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { candidateId } = await context.params;
  const result = await resolveOne(
    () => getSkillCandidate(candidateId),
    'skill candidate not found',
    (candidate) => ({ candidate }),
  );
  return NextResponse.json(result.body, { status: result.status });
}
