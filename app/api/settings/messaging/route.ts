// GET/POST /api/settings/messaging — list messaging claims, or add one.

import { NextResponse } from 'next/server';
import { messagingClaimInputSchema } from '@/app/lib/brandBrain.ts';
import { listMessagingClaims, createMessagingClaim } from '@/app/lib/db/messagingClaims.ts';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ claims: await listMessagingClaims() });
}

export async function POST(request: Request): Promise<NextResponse> {
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
  const claim = await createMessagingClaim(parsed.data);
  return NextResponse.json({ claim }, { status: 201 });
}
