import { z } from 'zod';

export const createSearchSchema = z.object({
  url: z.string().trim().url('A valid product-page URL is required'),
  forceRefresh: z.boolean().optional().default(false),
});

export type CreateSearchInput = z.infer<typeof createSearchSchema>;

export const batchItemSchema = z.object({
  mpn: z
    .string()
    .trim()
    .min(2, 'Part number is too short')
    .max(80, 'Part number is too long'),
  description: z.string().trim().max(500).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  quantity: z.number().int().positive().max(1_000_000).optional(),
});

export const createBatchSchema = z.object({
  items: z.array(batchItemSchema).min(1, 'Add at least one part').max(50, 'Max 50 parts per report'),
  forceRefresh: z.boolean().optional().default(false),
});

export type BatchItemInput = z.infer<typeof batchItemSchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
