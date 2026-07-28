import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { identifyManufacturerPartNumber } from './identify-mpn.js';

describe('identifyManufacturerPartNumber', () => {
  it('accepts high-confidence labeled MPN', () => {
    const result = identifyManufacturerPartNumber({
      evidence: [
        {
          value: 'LM7805CT',
          classification: 'mpn',
          source: 'labeled_dom',
          path: 'label:MPN',
          score: 0.88,
        },
      ],
      manufacturer: 'Texas Instruments',
      method: 'generic',
    });
    assert.equal('failed' in result, false);
    if (!('failed' in result)) {
      assert.equal(result.normalizedMpn, 'LM7805CT');
      assert.ok(result.confidence >= 0.72);
    }
  });

  it('fails when only SKU exists', () => {
    const result = identifyManufacturerPartNumber({
      evidence: [
        {
          value: 'C50931',
          classification: 'sku',
          source: 'labeled_dom',
          path: 'label:SKU',
          score: 0.5,
        },
      ],
      method: 'generic',
    });
    assert.equal('failed' in result && result.failed, true);
  });

  it('prefers longer path MPN over shorter family JSON-LD', () => {
    const result = identifyManufacturerPartNumber({
      mpn: 'UA78',
      evidence: [
        {
          value: 'UA78',
          classification: 'mpn',
          source: 'json_ld',
          path: 'ld.mpn',
          score: 0.92,
        },
        {
          value: 'UA7805',
          classification: 'mpn',
          source: 'heuristic',
          path: 'url.path:UA7805',
          score: 0.79,
        },
      ],
      manufacturer: 'TI',
      method: 'generic',
    });
    assert.equal('failed' in result, false);
    if (!('failed' in result)) {
      assert.equal(result.originalMpn, 'UA7805');
    }
  });
});
