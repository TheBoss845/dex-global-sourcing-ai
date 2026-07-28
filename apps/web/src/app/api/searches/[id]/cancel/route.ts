import { NextResponse } from 'next/server';
import { cancelSearchJob } from '@dex/core';

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const job = await cancelSearchJob(id);
  return NextResponse.json({ job });
}
