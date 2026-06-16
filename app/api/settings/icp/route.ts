// GET/POST /api/settings/icp — list ICP segments, or create one (slug id derived from the name).
// Thin Vercel route (constitution §1): validate + delegate to the repo. No model calls here.

import { NextResponse } from 'next/server';
import { icpInputSchema } from '@/app/lib/brandBrain.ts';
import { listIcpSegments, createIcpSegment } from '@/app/lib/db/icpSegments.ts';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ segments: await listIcpSegments() });
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }
  const parsed = icpInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid ICP input', details: parsed.error.issues }, { status: 400 });
  }
  const segment = await createIcpSegment(parsed.data);
  return NextResponse.json({ segment }, { status: 201 });
}
