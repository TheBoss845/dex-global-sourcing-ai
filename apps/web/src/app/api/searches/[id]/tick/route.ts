import { NextResponse } from 'next/server';
import { queueDriver, runPipelineTick, type PipelineEnv } from '@dex/core';
import { getServerEnv } from '@/lib/server-env';

export const maxDuration = 26;

/**
 * Serverless pipeline driver. In inline mode (Netlify — no Redis/worker),
 * each call advances the search by one bounded step; the dashboard polls
 * this while a job is running. In bullmq mode the background worker owns
 * the pipeline, so this is a no-op.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tick failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
