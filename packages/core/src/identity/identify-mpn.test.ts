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

  it('fails when only model/catalog exists', () => {
    const result = identifyManufacturerPartNumber({
      evidence: [
        {
          value: 'MODEL-100',
          classification: 'model',
          source: 'labeled_dom',
          path: 'label:Model',
          score: 0.7,
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

  it('fails low-confidence MPN candidates', () => {
    const result = identifyManufacturerPartNumber({
      evidence: [
        {
          value: 'XYZ',
          classification: 'mpn',
          source: 'heuristic',
          path: 'weak',
          score: 0.4,
        },
      ],
      method: 'generic',
    });
    assert.equal('failed' in result && result.failed, true);
  });

  it('never invents an MPN with empty evidence', () => {
    const result = identifyManufacturerPartNumber({
      evidence: [],
      method: 'generic',
    });
    assert.equal('failed' in result && result.failed, true);
  });
});
