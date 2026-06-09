// POST /api/skills/candidates/{candidateId}/reject (PRD §14.4, Gate #3).
// Thin per-candidate alias over the run-level resume-skill flow — see app/lib/skillCandidateGate.ts.
// zod-validated reviewer; on 'rejected' the worker records the rejection + a cooldown suppression
// and replaces no repo file.

import { NextResponse } from 'next/server';
import { decideSkillCandidate } from '@/app/lib/skillCandidateGate.ts';

export const runtime = 'nodejs';

interface RouteContext {
  readonly params: Promise<{ candidateId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { candidateId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const outcome = await decideSkillCandidate(candidateId, 'rejected', body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
