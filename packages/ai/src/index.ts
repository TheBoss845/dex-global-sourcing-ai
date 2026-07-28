import OpenAI from 'openai';
import { z } from 'zod';

export function isAiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AI_ENABLED === 'true' && Boolean(env.OPENAI_API_KEY);
}

const enrichmentSchema = z.object({
  cleanedDescription: z.string().optional(),
  summary: z.string(),
  suspiciousOfferIndexes: z.array(z.number().int().nonnegative()).default([]),
  notes: z.array(z.string()).default([]),
});

export type EnrichmentResult = z.infer<typeof enrichmentSchema>;

export async function enrichSearchResults(input: {
  apiKey: string;
  model: string;
  mpn: string;
  manufacturer?: string | null;
  offers: Array<{
    index: number;
    supplier: string;
    country?: string | null;
    priceUsd?: number | null;
    description?: string | null;
    productUrl: string;
  }>;
}): Promise<EnrichmentResult> {
  const client = new OpenAI({ apiKey: input.apiKey });
  const compact = input.offers.slice(0, 25).map((o) => ({
    index: o.index,
    supplier: o.supplier,
    country: o.country,
    priceUsd: o.priceUsd,
    description: o.description?.slice(0, 180) ?? null,
    productUrl: o.productUrl,
  }));

  const response = await client.chat.completions.create({
    model: input.model,
    temperature: 0.2,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You assist procurement engineers. Return JSON only. Flag suspicious/likely-counterfeit listings by index when price is an extreme outlier or marketplace signals look risky. Do not invent prices. Keep summary under 80 words.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          mpn: input.mpn,
          manufacturer: input.manufacturer,
          offers: compact,
        }),
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    return { summary: 'AI enrichment returned no content.', suspiciousOfferIndexes: [], notes: [] };
  }

  const parsed = enrichmentSchema.safeParse(JSON.parse(content));
  if (!parsed.success) {
    return {
      summary: 'AI enrichment returned invalid JSON; ignored.',
      suspiciousOfferIndexes: [],
      notes: ['invalid_ai_payload'],
    };
  }
  return parsed.data;
}
