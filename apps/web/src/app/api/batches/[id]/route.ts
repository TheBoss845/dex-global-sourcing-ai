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

    // Price history: best USD from the most recent earlier search of the same part.
    const previousBestByJob = new Map<string, number | null>();
    await Promise.all(
      jobs.map(async (job) => {
        if (!job.part?.normalizedMpn) return;
        try {
          const previous = await prisma.searchJob.findFirst({
            where: {
              id: { not: job.id },
              status: { in: ['completed', 'completed_with_errors'] },
              createdAt: { lt: job.createdAt },
              part: { normalizedMpn: job.part.normalizedMpn },
            },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          });
          if (!previous) return;
          const prevBest = await prisma.offer.aggregate({
            where: { jobId: previous.id, priceUsd: { not: null } },
            _min: { priceUsd: true },
          });
          previousBestByJob.set(
            job.id,
            prevBest._min.priceUsd ? Number(prevBest._min.priceUsd) : null,
          );
        } catch {
          // price history is best-effort — never block the batch view
        }
      }),
    );

    return NextResponse.json({
      batchId: id,
      jobs: jobs.map((job) => ({
        id: job.id,
        mpn: job.inputValue,
        productName: job.part?.displayName ?? null,
        // Prefer the AI-written description once enrichment has produced one.
        description: job.part?.descriptionClean ?? job.part?.title ?? null,
        imageUrl: job.part?.imageUrl ?? null,
        status: job.status,
        offerCount: job.offerCount,
        quantity: job.quantity ?? null,
        bestUsd: bestByJob.get(job.id) ?? null,
        previousBestUsd: previousBestByJob.get(job.id) ?? null,
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
