import { NextResponse } from 'next/server';
import { Prisma, prisma } from '@dex/db';
import { appendJobEvent } from '@dex/core';

type Params = { params: Promise<{ id: string }> };

/**
 * Reset a failed (or cancelled) job so the pipeline can run it again:
 * clears the error, restores a runnable status, re-opens failed candidates,
 * and restarts the wall-clock budget.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const job = await prisma.searchJob.findUnique({ where: { id } });
    if (!job) {
      return NextResponse.json({ error: 'Search not found' }, { status: 404 });
    }
    if (!['failed', 'cancelled'].includes(job.status)) {
      return NextResponse.json({ error: 'Only failed searches can be retried' }, { status: 409 });
    }

    const restartStatus = job.inputType === 'MPN' && job.partId ? 'identifying_mpn' : 'queued';

    await prisma.jobCandidate.updateMany({
      where: { jobId: id, status: { in: ['failed', 'extracting'] } },
      data: { status: 'pending', rejectionReason: null, errorMessage: null },
    });

    const updated = await prisma.searchJob.update({
      where: { id },
      data: {
        status: restartStatus,
        resolveStatus: job.inputType === 'MPN' && job.partId ? 'identified' : 'pending',
        errorCode: null,
        errorMessage: null,
        finishedAt: null,
        startedAt: null,
        progressJson: {
          stage: restartStatus,
          percent: restartStatus === 'queued' ? 0 : 30,
          tickErrors: 0,
        } as Prisma.InputJsonValue,
      },
    });

    await appendJobEvent(id, 'Retry requested — restarting the search', {
      stage: restartStatus,
    });

    return NextResponse.json({ ok: true, job: { id: updated.id, status: updated.status } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Retry failed' },
      { status: 500 },
    );
  }
}
