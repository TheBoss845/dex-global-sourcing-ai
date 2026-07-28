import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  INTEGRATIONS_FETCH_POLICY,
  HttpFetcher,
  extractGenericOffer,
  extractProductIdentity,
} from './index.js';

const PRODUCT_HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{"@type":"Product","name":"LM7805CT 5V Regulator","mpn":"LM7805CT","sku":"DK-5621","brand":{"name":"Texas Instruments"},"description":"Linear regulator"}
</script>
<meta property="og:title" content="LM7805CT - Texas Instruments" />
</head><body>
<h1>LM7805CT</h1>
<table>
<tr><th>Manufacturer Part Number</th><td>LM7805CT</td></tr>
<tr><th>Manufacturer</th><td>Texas Instruments</td></tr>
<tr><th>SKU</th><td>DK-5621</td></tr>
</table>
<span class="price">$0.48</span>
<span class="stock">In stock: 12500</span>
</body></html>`;

const AMBIGUOUS_HTML = `<!doctype html><html><body>
<h1>Alternatives</h1>
<p>Compatible with LM7805CT. Replacement for LM7805. Buy kit KIT-7805 instead. SKU 99988.</p>
<span class="price">$12.00</span>
</body></html>`;

const FAMILY_HTML = `<!doctype html><html><head>
<script type="application/ld+json">{"@type":"Product","name":"UA78","mpn":"UA78","brand":"TI"}</script>
</head><body><h1>UA78 family</h1><p>Orderables include UA7805.</p></body></html>`;

describe('integrations', () => {
  it('is http-first', () => {
    assert.equal(INTEGRATIONS_FETCH_POLICY, 'http-first');
  });

  it('does not treat search mpnHint as extracted page MPN', () => {
    const draft = extractGenericOffer(AMBIGUOUS_HTML, 'LM7805CT');
    assert.equal(draft.mpn, undefined);
  });

  it('extracts JSON-LD and labeled MPN with manufacturer', () => {
    const id = extractProductIdentity(PRODUCT_HTML, {
      pageUrl: 'https://example.com/product/LM7805CT',
    });
    assert.equal(id.mpn, 'LM7805CT');
    assert.equal(id.manufacturer, 'Texas Instruments');
    assert.ok(id.evidence.some((e) => e.classification === 'mpn'));
    assert.ok(id.evidence.some((e) => e.classification === 'sku' && e.value === 'DK-5621'));
  });

  it('prefers longer URL path MPN over family JSON-LD', () => {
    const id = extractProductIdentity(FAMILY_HTML, {
      pageUrl: 'https://www.ti.com/product/UA7805',
      finalUrl: 'https://www.ti.com/product/UA78',
    });
    assert.equal(id.mpn, 'UA7805');
  });

  it('does not invent MPN from mention-only pages', () => {
    const id = extractProductIdentity(AMBIGUOUS_HTML, {
      pageUrl: 'https://blog.example.com/alternatives',
    });
    assert.equal(id.mpn, undefined);
  });

  it('extracts price and stock from product HTML without inventing MPN', () => {
    const draft = extractGenericOffer(PRODUCT_HTML);
    assert.ok(draft.priceText?.includes('0.48'));
    assert.equal(draft.stockQuantity, 12500);
  });

  it('HttpFetcher blocks localhost', async () => {
    const fetcher = new HttpFetcher();
    await assert.rejects(() => fetcher.fetchText('http://127.0.0.1/'), /blocked|local|Private/i);
  });
});
