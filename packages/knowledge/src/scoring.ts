export type KnowledgeSuggestion = {
  supplierDomain: string;
  score: number;
  reasons: string[];
  preferred: boolean;
};

export const SCORING_VERSION = 'v1';

export function scoreSupplier(input: {
  preferred: boolean;
  reliabilityScore: number;
  mpnSuccessCount: number;
  searchFrequency: number;
  avgResponseQuality: number;
}): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0.2;

  if (input.preferred) {
    score += 0.35;
    reasons.push('marked preferred');
  }
  score += Math.min(0.3, input.reliabilityScore * 0.3);
  reasons.push(`reliability=${input.reliabilityScore.toFixed(2)}`);

  if (input.mpnSuccessCount > 0) {
    score += Math.min(0.25, input.mpnSuccessCount * 0.05);
    reasons.push(`mpn_successes=${input.mpnSuccessCount}`);
  }

  score += Math.min(0.1, input.avgResponseQuality * 0.1);
  score += Math.min(0.05, Math.log10(input.searchFrequency + 1) * 0.05);

  return { score: Math.max(0, Math.min(1, score)), reasons };
}
