import { NextResponse } from 'next/server';
import { queueDriver, runPipelineTick, type PipelineEnv } from '@dex/core';
import { prisma } from '@dex/db';
import { sessionSecret, verifySessionToken } from '@/lib/auth';
import { emailSendingConfigured } from '@/lib/email';
import { sendBatchReportEmail } from '@/lib/report-email';
import { getServerEnv } from '@/lib/server-env';

export const maxDuration = 26;

const TERMINAL = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled']);

/**
 * When the tick that just ran finished the LAST part of a batch, email the
 * report to the signed-in user. Fully best-effort: any failure is ignored.
 */
async function maybeEmailFinishedBatch(jobId: string, request: Request): Promise<void> {
  try {
    if (!emailSendingConfigured()) return;

    const job = await prisma.searchJob.findUnique({
      where: { id: jobId },
      select: { batchId: true },
    });
    if (!job?.batchId) return;

    const siblings = await prisma.searchJob.findMany({
      where: { batchId: job.batchId },
      select: { status: true, offerCount: true },
    });
    if (siblings.length === 0 || !siblings.every((s) => TERMINAL.has(s.status))) return;

    // Dedupe: send at most one email per batch.
    const alreadySent = await prisma.jobEvent.findFirst({
      where: { jobId, message: { startsWith: 'Report emailed' } },
      select: { id: true },
    });
    if (alreadySent) return;

    const secret = sessionSecret();
    if (!secret) return;
    const cookie = request.headers.get('cookie') ?? '';
    const match = cookie.match(/(?:^|;\s*)dex_session=([^;]+)/);
    const token = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    const session = await verifySessionToken(token, secret);
    if (!session.ok || !session.email) return;

    const sent = await sendBatchReportEmail({
      batchId: job.batchId,
      to: session.email,
      partCount: siblings.length,
      offerCount: siblings.reduce((sum, s) => sum + s.offerCount, 0),
    });
    if (sent) {
      await prisma.jobEvent.create({
        data: { jobId, message: `Report emailed to ${session.email}`, stage: 'report' },
      });
    }
  } catch {
    // never let report email problems affect the pipeline
  }
}

/**
 * Serverless pipeline driver. In inline mode (Netlify — no Redis/worker),
 * each call advances the search by one bounded step; the dashboard polls
 * this while a job is running. In bullmq mode the background worker owns
 * the pipeline, so this is a no-op.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    if (queueDriver() !== 'inline') {
      return NextResponse.json({ skipped: true, driver: 'bullmq' });
    }

    const { id } = await context.params;
    const env = getServerEnv();
    const pipelineEnv: PipelineEnv = {
      redisUrl: env.REDIS_URL,
      tavilyApiKey: env.TAVILY_API_KEY,
      aiEnabled: Boolean(env.AI_ENABLED),
      openaiApiKey: env.OPENAI_API_KEY,
      openaiModel: env.OPENAI_MODEL,
      artifactLocalPath: env.ARTIFACT_LOCAL_PATH,
      resultLimit: env.RESULT_LIMIT,
    };

    const result = await runPipelineTick(id, pipelineEnv);
    if (result.state === 'done' && result.stage !== 'missing') {
      await maybeEmailFinishedBatch(id, request);
    }
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tick failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
