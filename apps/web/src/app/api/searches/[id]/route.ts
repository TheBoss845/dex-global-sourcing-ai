import { NextResponse } from 'next/server';
import { AppError, getSearchJob } from '@dex/core';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const job = await getSearchJob(id);
    return NextResponse.json(job);
  } catch (error) {
    const status = error instanceof AppError && error.code === 'NOT_FOUND' ? 404 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load job' },
      { status },
    );
  }
}
