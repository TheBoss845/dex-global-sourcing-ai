export { loadEnv } from './config/env.js';
export type { AppEnv } from './config/env.js';
export { AppError, ErrorCodes } from './errors.js';
export { DEFAULT_JOB_BUDGET, QUEUE_NAMES } from './budget.js';
export type { JobBudget, QueueName } from './budget.js';
export { normalizeMpn, mpnsMatch } from './mpn.js';
export { parseMoney, fetchUsdRates, toUsd } from './money.js';
export { assertSafeUrl, extractRegistrableDomain } from './security/url.js';
export { createSearchSchema } from './search/schema.js';
export type { CreateSearchInput } from './search/schema.js';
export {
  createSearchJob,
  getSearchJob,
  listJobEvents,
  listJobOffers,
  cancelSearchJob,
  appendJobEvent,
  setJobStatus,
} from './search/service.js';
export { createRedisConnection, enqueue } from './queue.js';
export {
  runResolveStage,
  runDiscoverStage,
  runExtractStage,
  runNormalizeStage,
  runEnrichStage,
  runKnowledgeStage,
} from './pipeline/stages.js';
export type { PipelineEnv } from './pipeline/stages.js';

export const CORE_PACKAGE_VERSION = '0.1.0';
