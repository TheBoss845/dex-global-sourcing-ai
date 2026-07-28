import { normalizeMpn } from '../mpn.js';

export type IdentityEvidenceLike = {
  value: string;
  classification: string;
  source: string;
  path: string;
  score: number;
};

export type MpnIdentification = {
  originalMpn: string;
  normalizedMpn: string;
  manufacturer?: string;
  brand?: string;
  supplierSku?: string;
  modelNumber?: string;
  title?: string;
  description?: string;
  confidence: number;
  method: string;
  evidence: IdentityEvidenceLike[];
  chosenEvidence: IdentityEvidenceLike[];
};

const MIN_CONFIDENCE = 0.72;

/**
 * Deterministic MPN selection. Never invents values not present in evidence/draft.
 */
export function identifyManufacturerPartNumber(input: {
  mpn?: string;
  manufacturer?: string;
  brand?: string;
  supplierSku?: string;
  modelNumber?: string;
  title?: string;
  description?: string;
  evidence: IdentityEvidenceLike[];
  method: string;
}): MpnIdentification | { failed: true; reason: string; confidence: number; evidence: IdentityEvidenceLike[] } {
  const mpnEvidence = input.evidence
    .filter((e) => e.classification === 'mpn')
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.value.length - a.value.length;
    });

  // Prefer a longer, more specific MPN when one candidate contains another
  // (e.g. URL path UA7805 vs JSON-LD family UA78).
  const refined = refineMpnEvidence(mpnEvidence);

  let originalMpn = input.mpn?.trim();
  let confidence = 0;
  let chosen: IdentityEvidenceLike[] = [];

  if (originalMpn) {
    // Upgrade draft mpn if evidence has a longer containing token with solid score.
    const upgrade = refined.find(
      (e) =>
        normalizeMpn(e.value).includes(normalizeMpn(originalMpn!)) &&
        normalizeMpn(e.value).length > normalizeMpn(originalMpn!).length &&
        e.score >= 0.7,
    );
    if (upgrade) {
      originalMpn = upgrade.value;
      confidence = Math.max(upgrade.score, 0.85);
      chosen = [upgrade];
    } else {
      const match = refined.find((e) => normalizeMpn(e.value) === normalizeMpn(originalMpn!));
      confidence = match?.score ?? 0.8;
      chosen = match
        ? [match]
        : [
            {
              value: originalMpn,
              classification: 'mpn',
              source: 'adapter',
              path: 'draft.mpn',
              score: confidence,
            },
          ];
    }
  } else if (refined[0]) {
    originalMpn = refined[0].value;
    confidence = refined[0].score;
    chosen = [refined[0]];
  }

  // Do not promote SKU/model to MPN automatically.
  if (!originalMpn) {
    return {
      failed: true,
      reason:
        'Could not determine an exact manufacturer part number from this page. No labeled MPN or structured mpn field was found.',
      confidence: 0,
      evidence: input.evidence,
    };
  }

  const normalizedMpn = normalizeMpn(originalMpn);
  if (!normalizedMpn || normalizedMpn.length < 3) {
    return {
      failed: true,
      reason: 'Extracted manufacturer part number was empty or too short after normalization.',
      confidence: confidence * 0.5,
      evidence: input.evidence,
    };
  }

  // Penalize if only weak sources and equals SKU
  if (input.supplierSku && normalizeMpn(input.supplierSku) === normalizedMpn && confidence < 0.85) {
    confidence *= 0.85;
  }

  if (confidence < MIN_CONFIDENCE) {
    return {
      failed: true,
      reason: `Manufacturer part number candidates were found but identification confidence (${confidence.toFixed(2)}) is too low to continue automatically.`,
      confidence,
      evidence: input.evidence,
    };
  }

  return {
    originalMpn,
    normalizedMpn,
    manufacturer: input.manufacturer,
    brand: input.brand,
    supplierSku: input.supplierSku,
    modelNumber: input.modelNumber,
    title: input.title,
    description: input.description,
    confidence,
    method: input.method,
    evidence: input.evidence,
    chosenEvidence: chosen,
  };
}

function refineMpnEvidence(evidence: IdentityEvidenceLike[]): IdentityEvidenceLike[] {
  if (evidence.length <= 1) return evidence;
  const sorted = [...evidence].sort((a, b) => {
    const aN = normalizeMpn(a.value);
    const bN = normalizeMpn(b.value);
    // Prefer longer tokens that contain shorter ones, even if score is slightly lower.
    if (aN !== bN && aN.includes(bN) && a.score >= b.score - 0.25) return -1;
    if (aN !== bN && bN.includes(aN) && b.score >= a.score - 0.25) return 1;
    if (b.score !== a.score) return b.score - a.score;
    return bN.length - aN.length;
  });
  return sorted;
}

export const MPN_MIN_CONFIDENCE = MIN_CONFIDENCE;
