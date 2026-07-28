import { NextResponse } from 'next/server';
import { getBatchJobs } from '@dex/core';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const jobs = await getBatchJobs(id);
    if (jobs.length === 0) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }
    return NextResponse.json({
      batchId: id,
      jobs: jobs.map((job) => ({
        id: job.id,
        mpn: job.inputValue,
        description: job.part?.title ?? null,
        status: job.status,
        offerCount: job.offerCount,
        errorMessage: job.errorMessage,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load batch' },
      { status: 500 },
    );
  }
}
