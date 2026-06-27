// POST/DELETE /api/settings/agents — operator edits to the agent→capability mapping (migration
// 0035). POST adds one (agent, capability) edge as an operator override; DELETE removes one. The
// worker gates generation by this allowlist (DB-wins-per-agent over the code default). No model
// calls here (constitution §1). All writes are parameterised; the agent id and artifact type are
// validated against their closed vocabularies.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isArtifactType } from '@/app/lib/artifactTypes.ts';
import { isAgentId } from '@/app/lib/agentStages.ts';
import {
  upsertAgentCapability,
  deleteAgentCapability,
} from '@/app/lib/db/agentCapabilities.ts';

export const runtime = 'nodejs';

const editSchema = z.object({
  agent_id: z.string().trim().refine(isAgentId, {
    message: 'agent_id must be a known pipeline agent',
  }),
  artifact_type: z.string().trim().refine(isArtifactType, {
    message: 'artifact_type must be a known artifact type',
  }),
});

async function parse(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = editSchema.safeParse(await parse(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid agent capability', details: parsed.error.issues },
      { status: 400 },
    );
  }
  await upsertAgentCapability(parsed.data.agent_id, parsed.data.artifact_type);
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const parsed = editSchema.safeParse(await parse(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid agent capability', details: parsed.error.issues },
      { status: 400 },
    );
  }
  const removed = await deleteAgentCapability(parsed.data.agent_id, parsed.data.artifact_type);
  return NextResponse.json({ ok: true, removed });
}
