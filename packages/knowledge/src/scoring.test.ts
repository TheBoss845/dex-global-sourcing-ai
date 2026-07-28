import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { scoreSupplier } from './scoring.js';

describe('scoreSupplier', () => {
  it('boosts preferred reliable suppliers', () => {
    const low = scoreSupplier({
      preferred: false,
      reliabilityScore: 0.2,
      mpnSuccessCount: 0,
      searchFrequency: 0,
      avgResponseQuality: 0,
    });
    const high = scoreSupplier({
      preferred: true,
      reliabilityScore: 0.9,
      mpnSuccessCount: 5,
      searchFrequency: 20,
      avgResponseQuality: 0.8,
    });
    assert.ok(high.score > low.score);
    assert.ok(high.reasons.includes('marked preferred'));
  });
});
