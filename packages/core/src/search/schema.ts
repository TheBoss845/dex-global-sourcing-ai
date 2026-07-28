import { z } from 'zod';

export const createSearchSchema = z.object({
  url: z.string().trim().url('A valid product-page URL is required'),
  forceRefresh: z.boolean().optional().default(false),
});

export type CreateSearchInput = z.infer<typeof createSearchSchema>;
