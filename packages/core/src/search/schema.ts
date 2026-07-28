import { z } from 'zod';

export const createSearchSchema = z
  .object({
    mpn: z.string().trim().min(1).max(128).optional(),
    url: z.string().trim().url().optional(),
    forceRefresh: z.boolean().optional().default(false),
  })
  .refine((value) => Boolean(value.mpn || value.url), {
    message: 'Either mpn or url is required',
  })
  .refine((value) => !(value.mpn && value.url), {
    message: 'Provide either mpn or url, not both',
  });

export type CreateSearchInput = z.infer<typeof createSearchSchema>;
