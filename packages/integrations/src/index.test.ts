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

const TRICKY_PRICE_HTML = `<!doctype html><html><head>
<script type="application/ld+json">
{"@type":"Product","name":"Widget X","sku":"W-1","offers":{"@type":"Offer","price":"24.99","priceCurrency":"EUR","availability":"https://schema.org/InStock"}}
</script>
</head><body>
<span>Free shipping on orders over $50</span>
<span class="price was-price">$99.00</span>
<span class="price">$31.00</span>
<p>Ships in 3 days</p>
<div class="stock">Ships in 3 days</div>
</body></html>`;

const NO_STRUCTURED_PRICE_HTML = `<!doctype html><html><body>
<h1>Widget Y</h1>
<span>Shipping: $5.99</span>
<span class="price compare-at">Was $50.00</span>
<span class="price">$19.95</span>
<div class="stock">In stock: 240 units</div>
</body></html>`;

const GARBAGE_PRICE_HTML = `<!doctype html><html><body>
<h1>Widget Z</h1>
<p>Orders over $100 ship free. Save $20 today!</p>
<span class="price">$10.00 - $250.00</span>
</body></html>`;

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

  it('prefers JSON-LD price over page spans and reads availability', () => {
    const draft = extractGenericOffer(TRICKY_PRICE_HTML);
    assert.ok(draft.priceText?.includes('24.99'), `got ${draft.priceText}`);
    assert.equal(draft.currency, 'EUR');
    assert.equal(draft.availability, 'In stock');
    // "Ships in 3 days" must not become stock quantity 3.
    assert.equal(draft.stockQuantity, null);
  });

  it('skips was/compare/shipping prices and picks the live price', () => {
    const draft = extractGenericOffer(NO_STRUCTURED_PRICE_HTML);
    assert.ok(draft.priceText?.includes('19.95'), `got ${draft.priceText}`);
    assert.equal(draft.stockQuantity, 240);
  });

  it('returns no price rather than guessing from ranges and promo text', () => {
    const draft = extractGenericOffer(GARBAGE_PRICE_HTML);
    assert.equal(draft.priceText, undefined);
  });

  it('HttpFetcher blocks localhost', async () => {
    const fetcher = new HttpFetcher();
    await assert.rejects(() => fetcher.fetchText('http://127.0.0.1/'), /blocked|local|Private/i);
  });
});
