// PATCH/DELETE /api/settings/icp/{id} — update or remove one ICP segment.

import { NextResponse } from 'next/server';
import { icpInputSchema } from '@/app/lib/brandBrain.ts';
import { updateIcpSegment, deleteIcpSegment } from '@/app/lib/db/icpSegments.ts';

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
  const parsed = icpInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid ICP input', details: parsed.error.issues }, { status: 400 });
  }
  const segment = await updateIcpSegment(id, parsed.data);
  if (segment === null) {
    return NextResponse.json({ error: 'ICP segment not found' }, { status: 404 });
  }
  return NextResponse.json({ segment }, { status: 200 });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  await deleteIcpSegment(id);
  return NextResponse.json({ deleted: true }, { status: 200 });
}
