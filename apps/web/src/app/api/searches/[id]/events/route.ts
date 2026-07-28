import { NextResponse } from 'next/server';
import { listJobEvents } from '@dex/core';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const after = new URL(request.url).searchParams.get('after') ?? undefined;
  const events = await listJobEvents(id, after);
  return NextResponse.json({ events });
}
