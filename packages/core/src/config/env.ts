import { z } from 'zod';

const boolFromString = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => value === true || value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ARTIFACT_STORAGE: z.enum(['local', 's3', 'minio']).default('local'),
  ARTIFACT_LOCAL_PATH: z.string().default('.artifacts'),
  AI_ENABLED: boolFromString,
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  TAVILY_API_KEY: z.string().optional().default(''),
  SUPPLYITNOW_ALLOWED_HOSTS: z
    .string()
    .default('www.supplyitnow.com,supplyitnow.com')
    .transform((value) =>
      value
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ),
  WORKER_QUEUES: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}
