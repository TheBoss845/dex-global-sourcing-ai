import { Queue } from 'bullmq';

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
