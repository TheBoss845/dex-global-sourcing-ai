import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { Worker } from 'bullmq';
import {
  AppError,
  QUEUE_NAMES,
  appendJobEvent,
  createRedisConnection,
  loadEnv,
  runDiscoverStage,
  runEnrichStage,
  runExtractStage,
  runKnowledgeStage,
  runNormalizeStage,
  runResolveStage,
  setJobStatus,
  type PipelineEnv,
} from '@dex/core';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
loadDotenv({ path: path.join(rootDir, '.env') });

const env = loadEnv(process.env);

if (!env.REDIS_URL?.trim()) {
  console.error(
    '[dex-worker] REDIS_URL is not set. The worker needs Redis (BullMQ). ' +
      'Serverless deployments (Netlify) do not run this worker — they use QUEUE_DRIVER=inline instead.',
  );
  process.exit(1);
}

const pipelineEnv: PipelineEnv = {
  redisUrl: env.REDIS_URL,
  tavilyApiKey: env.TAVILY_API_KEY,
  aiEnabled: Boolean(env.AI_ENABLED),
  openaiApiKey: env.OPENAI_API_KEY,
  openaiModel: env.OPENAI_MODEL,
  artifactLocalPath: env.ARTIFACT_LOCAL_PATH,
  resultLimit: env.RESULT_LIMIT,
};

function selectedQueues(): string[] {
  if (env.WORKER_QUEUES?.trim()) {
    return env.WORKER_QUEUES.split(',')
      .map((q) => q.trim())
      .filter(Boolean);
  }
  return [...QUEUE_NAMES];
}

async function handleFailure(jobId: string | undefined, error: unknown) {
  if (!jobId) return;
  const message = error instanceof Error ? error.message : 'Unknown worker error';
  const code = error instanceof AppError ? error.code : 'WORKER_ERROR';
  await setJobStatus(jobId, 'failed', {
    finishedAt: new Date(),
    errorCode: code,
    errorMessage: message,
    progressJson: { stage: 'failed', percent: 100 },
  });
  await appendJobEvent(jobId, message, { stage: 'failed', level: 'error' });
}

function startWorkers() {
  const connection = createRedisConnection(env.REDIS_URL);
  const queues = selectedQueues();
  const workers: Worker[] = [];

  console.log('[dex-worker] starting');
  console.log(`[dex-worker] queues=${queues.join(',')}`);
  console.log(`[dex-worker] aiEnabled=${pipelineEnv.aiEnabled}`);

  const handlers: Record<string, (jobId: string) => Promise<void>> = {
    'jobs-resolve': (jobId) => runResolveStage(jobId, pipelineEnv),
    'jobs-discover': (jobId) => runDiscoverStage(jobId, pipelineEnv),
    'jobs-extract': (jobId) => runExtractStage(jobId, pipelineEnv),
    'jobs-normalize': (jobId) => runNormalizeStage(jobId, pipelineEnv),
    'jobs-enrich': (jobId) => runEnrichStage(jobId, pipelineEnv),
    'jobs-knowledge': (jobId) => runKnowledgeStage(jobId),
  };

  for (const queueName of queues) {
    const handler = handlers[queueName];
    if (!handler) continue;
    workers.push(
      new Worker(
        queueName,
        async (job) => {
          const jobId = String(job.data.jobId);
          try {
            await handler(jobId);
          } catch (error) {
            await handleFailure(jobId, error);
            throw error;
          }
        },
        {
          connection,
          concurrency: queueName === 'jobs-extract' || queueName === 'jobs-enrich' ? 1 : 2,
        },
      ),
    );
  }

  for (const worker of workers) {
    worker.on('failed', (job, err) => {
      console.error(`[dex-worker] job failed queue=${worker.name} id=${job?.id}`, err.message);
    });
  }

  const shutdown = async (signal: string) => {
    console.log(`[dex-worker] received ${signal}, shutting down`);
    await Promise.all(workers.map((w) => w.close()));
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  console.log('[dex-worker] ready');
}

startWorkers();
