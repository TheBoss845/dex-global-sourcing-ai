import { z } from 'zod';

const boolFromString = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((value) => value === true || value === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  // Optional: serverless deployments (Netlify) run without Redis via QUEUE_DRIVER=inline.
  REDIS_URL: z.string().optional().default(''),
  QUEUE_DRIVER: z.enum(['bullmq', 'inline']).optional(),
  ARTIFACT_STORAGE: z.enum(['local', 's3', 'minio']).default('local'),
  ARTIFACT_LOCAL_PATH: z.string().default('.artifacts'),
  AI_ENABLED: boolFromString,
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  TAVILY_API_KEY: z.string().optional().default(''),
  WORKER_QUEUES: z.string().optional(),
  RESULT_LIMIT: z
    .string()
    .optional()
    .transform((value) => {
      const n = Number(value ?? '10');
      return Number.isFinite(n) && n > 0 ? Math.min(25, Math.floor(n)) : 10;
    }),
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
