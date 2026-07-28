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

const pipelineEnv: PipelineEnv = {
  redisUrl: env.REDIS_URL,
  tavilyApiKey: env.TAVILY_API_KEY,
  aiEnabled: Boolean(env.AI_ENABLED),
  openaiApiKey: env.OPENAI_API_KEY,
  openaiModel: env.OPENAI_MODEL,
  artifactLocalPath: env.ARTIFACT_LOCAL_PATH,
  supplyItNowHosts: env.SUPPLYITNOW_ALLOWED_HOSTS,
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

  if (queues.includes('jobs-resolve')) {
    workers.push(
      new Worker(
        'jobs-resolve',
        async (job) => {
          const jobId = String(job.data.jobId);
          try {
            await runResolveStage(jobId, pipelineEnv);
          } catch (error) {
            await handleFailure(jobId, error);
            throw error;
          }
        },
        { connection, concurrency: 2 },
      ),
    );
  }

  if (queues.includes('jobs-discover')) {
    workers.push(
      new Worker(
        'jobs-discover',
        async (job) => {
          const jobId = String(job.data.jobId);
          try {
            await runDiscoverStage(jobId, pipelineEnv);
          } catch (error) {
            await handleFailure(jobId, error);
            throw error;
          }
        },
        { connection, concurrency: 2 },
      ),
    );
  }

  if (queues.includes('jobs-extract')) {
    workers.push(
      new Worker(
        'jobs-extract',
        async (job) => {
          const jobId = String(job.data.jobId);
          try {
            await runExtractStage(jobId, pipelineEnv);
          } catch (error) {
            await handleFailure(jobId, error);
            throw error;
          }
        },
        { connection, concurrency: 1 },
      ),
    );
  }

  if (queues.includes('jobs-normalize')) {
    workers.push(
      new Worker(
        'jobs-normalize',
        async (job) => {
          const jobId = String(job.data.jobId);
          try {
            await runNormalizeStage(jobId, pipelineEnv);
          } catch (error) {
            await handleFailure(jobId, error);
            throw error;
          }
        },
        { connection, concurrency: 2 },
      ),
    );
  }

  if (queues.includes('jobs-enrich')) {
    workers.push(
      new Worker(
        'jobs-enrich',
        async (job) => {
          const jobId = String(job.data.jobId);
          try {
            await runEnrichStage(jobId, pipelineEnv);
          } catch (error) {
            await handleFailure(jobId, error);
            throw error;
          }
        },
        { connection, concurrency: 1 },
      ),
    );
  }

  if (queues.includes('jobs-knowledge')) {
    workers.push(
      new Worker(
        'jobs-knowledge',
        async (job) => {
          const jobId = String(job.data.jobId);
          await runKnowledgeStage(jobId);
        },
        { connection, concurrency: 2 },
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
