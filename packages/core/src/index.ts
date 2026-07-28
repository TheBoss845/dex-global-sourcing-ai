export { loadEnv } from './config/env.js';
export type { AppEnv } from './config/env.js';
export { AppError, ErrorCodes } from './errors.js';
export { DEFAULT_JOB_BUDGET, QUEUE_NAMES } from './budget.js';
export type { JobBudget, QueueName } from './budget.js';
export { normalizeMpn, mpnsMatch } from './mpn.js';
export { parseMoney, fetchUsdRates, toUsd } from './money.js';
export {
  assertSafeUrl,
  assertSafePublicUrl,
  extractRegistrableDomain,
  isBlockedHostnameOrIp,
} from './security/url.js';
export { safeFetchText } from './security/safe-fetch.js';
export { identifyManufacturerPartNumber, MPN_MIN_CONFIDENCE } from './identity/identify-mpn.js';
export { createSearchSchema, createBatchSchema, batchItemSchema } from './search/schema.js';
export { parsePastedPartsList } from './search/parse-paste.js';
export type { CreateSearchInput, CreateBatchInput, BatchItemInput } from './search/schema.js';
export {
  createSearchJob,
  createMpnSearchJob,
  createBatchSearchJobs,
  getBatchJobs,
  getSearchJob,
  listJobEvents,
  listJobOffers,
  cancelSearchJob,
  appendJobEvent,
  setJobStatus,
} from './search/service.js';
export { createRedisConnection, enqueue, queueDriver } from './queue.js';
export {
  runResolveStage,
  runDiscoverStage,
  runExtractStage,
  runNormalizeStage,
  runEnrichStage,
  runKnowledgeStage,
  runPipelineTick,
} from './pipeline/stages.js';
export type { PipelineEnv } from './pipeline/stages.js';

export const CORE_PACKAGE_VERSION = '0.2.0';
