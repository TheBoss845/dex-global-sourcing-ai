import { Queue } from 'bullmq';

/**
 * Queue driver:
 * - 'bullmq'  — Redis-backed background worker (Render, local docker).
 * - 'inline'  — serverless mode (Netlify): no Redis/worker; the pipeline is
 *   advanced step-by-step by /api/searches/[id]/tick calls from the dashboard.
 */
export function queueDriver(): 'inline' | 'bullmq' {
  const explicit = process.env.QUEUE_DRIVER?.trim().toLowerCase();
  if (explicit === 'inline') return 'inline';
  if (explicit === 'bullmq') return 'bullmq';
  return process.env.REDIS_URL?.trim() ? 'bullmq' : 'inline';
}

export function createRedisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password || undefined,
    username: url.username || undefined,
    maxRetriesPerRequest: null as null,
  };
}

export async function enqueue(
  redisUrl: string,
  queueName: string,
  name: string,
  data: Record<string, unknown>,
  jobId?: string,
): Promise<void> {
  // Inline mode has no queue: runPipelineTick drives stage progression.
  if (queueDriver() === 'inline') return;

  const queue = new Queue(queueName, { connection: createRedisConnection(redisUrl) });
  try {
    await queue.add(name, data, {
      jobId,
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });
  } finally {
    await queue.close();
  }
}
