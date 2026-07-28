import { NextResponse } from 'next/server';
import { getBatchJobs } from '@dex/core';
import { prisma } from '@dex/db';

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const jobs = await getBatchJobs(id);
    if (jobs.length === 0) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    // Cheapest USD offer per part for the live progress table.
    const cheapest = await prisma.offer.groupBy({
      by: ['jobId'],
      where: { jobId: { in: jobs.map((job) => job.id) }, priceUsd: { not: null } },
      _min: { priceUsd: true },
    });
    const bestByJob = new Map(
      cheapest.map((row) => [row.jobId, row._min.priceUsd ? Number(row._min.priceUsd) : null]),
    );

    return NextResponse.json({
      batchId: id,
      jobs: jobs.map((job) => ({
        id: job.id,
        mpn: job.inputValue,
        description: job.part?.title ?? null,
        status: job.status,
        offerCount: job.offerCount,
        bestUsd: bestByJob.get(job.id) ?? null,
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
