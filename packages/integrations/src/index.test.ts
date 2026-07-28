import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractGenericOffer } from './extractors/generic.js';
import { extractProductIdentity } from './extractors/identity.js';
import { INTEGRATIONS_FETCH_POLICY } from './index.js';

describe('integrations', () => {
  it('is http-first', () => {
    assert.equal(INTEGRATIONS_FETCH_POLICY, 'http-first');
  });

  it('does not treat search mpnHint as extracted page MPN', () => {
    const html = `<html><body><h1>Alternatives guide</h1><p>Compatible with LM7805CT</p></body></html>`;
    const draft = extractGenericOffer(html, 'LM7805CT');
    assert.equal(draft.mpn, undefined);
  });

  it('extracts structured product identity', () => {
    const html = `<html><head><script type="application/ld+json">{"@type":"Product","mpn":"LM7805CT","brand":"TI"}</script></head><body><h1>LM7805CT</h1></body></html>`;
    const id = extractProductIdentity(html, { pageUrl: 'https://example.com/product/LM7805CT' });
    assert.equal(id.mpn, 'LM7805CT');
  });
});
