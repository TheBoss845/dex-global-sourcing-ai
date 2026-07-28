export type JobBudget = {
  maxSerpQueries: number;
  maxCandidates: number;
  maxBrowserNavigations: number;
  maxAiCalls: number;
  wallClockMs: number;
};

export const DEFAULT_JOB_BUDGET: JobBudget = {
  maxSerpQueries: 4,
  maxCandidates: 18,
  maxBrowserNavigations: 5,
  maxAiCalls: 8,
  wallClockMs: 10 * 60 * 1000,
};

export const QUEUE_NAMES = [
  'jobs-resolve',
  'jobs-discover',
  'jobs-extract',
  'jobs-normalize',
  'jobs-enrich',
  'jobs-knowledge',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];
