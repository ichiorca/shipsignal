// PATCH/DELETE /api/settings/messaging/{id} — update or remove one messaging claim.

import { NextResponse } from 'next/server';
import { messagingClaimInputSchema } from '@/app/lib/brandBrain.ts';
import { updateMessagingClaim, deleteMessagingClaim } from '@/app/lib/db/messagingClaims.ts';

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
  const parsed = messagingClaimInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid messaging claim input', details: parsed.error.issues },
      { status: 400 },
    );
  }
  const claim = await updateMessagingClaim(id, parsed.data);
  if (claim === null) {
    return NextResponse.json({ error: 'messaging claim not found' }, { status: 404 });
  }
  return NextResponse.json({ claim }, { status: 200 });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const deleted = await deleteMessagingClaim(id);
  if (!deleted) {
    return NextResponse.json({ error: 'messaging claim not found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true }, { status: 200 });
}
