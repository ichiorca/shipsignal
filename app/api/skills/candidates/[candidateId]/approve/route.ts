// POST /api/skills/candidates/{candidateId}/approve (PRD §14.4, Gate #3).
// Thin per-candidate alias over the run-level resume-skill flow — see app/lib/skillCandidateGate.ts.
// zod-validated reviewer (no anonymous self-approval); the worker performs the repo SKILL.md
// replacement on the runner, never this route (constitution §1).

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

  const outcome = await decideSkillCandidate(candidateId, 'approved', body);
  return NextResponse.json(outcome.body, { status: outcome.status });
}
