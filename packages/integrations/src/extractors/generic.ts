import * as cheerio from 'cheerio';
import type { OfferDraft } from '../types.js';

function text($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = $(selector).first().text().replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return undefined;
}

type JsonLdOffer = {
  price?: number;
  currency?: string;
  availability?: string;
};

type JsonLdProduct = {
  name?: string;
  mpn?: string;
  sku?: string;
  brand?: string;
  offer?: JsonLdOffer;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readAvailability(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const tail = raw.split('/').pop() ?? raw;
  const map: Record<string, string> = {
    InStock: 'In stock',
    OutOfStock: 'Out of stock',
    PreOrder: 'Pre-order',
    BackOrder: 'Back-order',
    LimitedAvailability: 'Limited availability',
    Discontinued: 'Discontinued',
    SoldOut: 'Sold out',
  };
  return map[tail] ?? undefined;
}

function readJsonLdOffer(raw: unknown): JsonLdOffer | undefined {
  const list = Array.isArray(raw) ? raw : [raw];
  for (const entry of list) {
    const offer = asRecord(entry);
    if (!offer) continue;
    // AggregateOffer: lowPrice is a legitimate "from" price.
    const priceRaw = offer.price ?? offer.lowPrice;
    const price = typeof priceRaw === 'string' ? Number(priceRaw) : (priceRaw as number | undefined);
    const currency =
      typeof offer.priceCurrency === 'string' ? offer.priceCurrency.toUpperCase() : undefined;
    const availability = readAvailability(offer.availability);
    if ((Number.isFinite(price) && (price as number) > 0) || availability) {
      return {
        price: Number.isFinite(price) && (price as number) > 0 ? (price as number) : undefined,
        currency,
        availability,
      };
    }
  }
  return undefined;
}

function findJsonLdProduct($: cheerio.CheerioAPI): JsonLdProduct | undefined {
  let found: JsonLdProduct | undefined;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    const rawText = $(el).contents().text();
    if (!rawText.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return;
    }
    const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length) {
      const nodeRaw = queue.shift();
      const node = asRecord(nodeRaw);
      if (!node) continue;
      if (Array.isArray(node['@graph'])) queue.push(...(node['@graph'] as unknown[]));
      const type = node['@type'];
      const types = Array.isArray(type) ? type : [type];
      if (!types.includes('Product')) continue;
      const brandRaw = node.brand;
      const brand =
        typeof brandRaw === 'string'
          ? brandRaw
          : typeof asRecord(brandRaw)?.name === 'string'
            ? (asRecord(brandRaw)!.name as string)
            : undefined;
      found = {
        name: typeof node.name === 'string' ? node.name : undefined,
        mpn: typeof node.mpn === 'string' || typeof node.mpn === 'number' ? String(node.mpn) : undefined,
        sku: typeof node.sku === 'string' || typeof node.sku === 'number' ? String(node.sku) : undefined,
        brand,
        offer: readJsonLdOffer(node.offers),
      };
      return;
    }
  });
  return found;
}

/** Words that mark a price as NOT the live selling price. */
const PRICE_CONTEXT_BLOCKLIST =
  /\b(was|list price|msrp|rrp|compare at|reg\.?|regular price|save|you save|shipping|delivery|tax|per month|\/mo)\b/i;
const PRICE_CLASS_BLOCKLIST = /(was|old|strike|cross|compare|list-price|msrp|rrp|discount|savings|shipping)/i;
const PRICE_MAX_PLAUSIBLE = 500_000;

function cssPriceCandidate($: cheerio.CheerioAPI): string | undefined {
  const selectors = [
    '[itemprop="price"]',
    'meta[itemprop="price"]',
    '.special-price',
    '.sale-price',
    '.price--current',
    '.price__current',
    '.product-price',
    '.price',
    '[data-price]',
  ];
  for (const selector of selectors) {
    const elements = $(selector).toArray();
    for (const el of elements) {
      const node = $(el);
      const classChain = [
        node.attr('class') ?? '',
        node.parent().attr('class') ?? '',
        node.parent().parent().attr('class') ?? '',
      ].join(' ');
      if (PRICE_CLASS_BLOCKLIST.test(classChain)) continue;

      const raw =
        node.attr('content')?.trim() ||
        node.attr('data-price')?.trim() ||
        node.text().replace(/\s+/g, ' ').trim();
      if (!raw) continue;
      if (PRICE_CONTEXT_BLOCKLIST.test(raw)) continue;
      // A price range in free text is ambiguous — skip rather than guess.
      if (/\d[\d,.]*\s*[-–—]\s*[$€£¥]?\s*\d/.test(raw)) continue;
      const amountMatch = raw.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
      if (!amountMatch) continue;
      const amount = Number(amountMatch[0]);
      if (!Number.isFinite(amount) || amount <= 0 || amount > PRICE_MAX_PLAUSIBLE) continue;
      return raw;
    }
  }
  return undefined;
}

/**
 * Generic HTTP extractor for long-tail supplier pages.
 *
 * Price trust order:
 *  1. JSON-LD Product offers (price/lowPrice + priceCurrency)
 *  2. Open Graph / meta product price tags
 *  3. Filtered CSS price elements (never "was"/list/shipping amounts,
 *     never free-text ranges) — or no price at all. A missing price is
 *     honest; a wrong price is not.
 *
 * @param mpnHint optional search MPN used only to locate price/stock near a match —
 *   never returned as the page's extracted MPN (that caused false-positive offers).
 */
export function extractGenericOffer(html: string, mpnHint?: string): OfferDraft {
  const $ = cheerio.load(html);
  const title = text($, ['h1', 'title', '[property="og:title"]']) || undefined;
  const jsonLd = findJsonLdProduct($);

  let priceText: string | undefined;
  let currency: string | undefined;
  let availability: string | undefined = jsonLd?.offer?.availability;

  if (jsonLd?.offer?.price != null) {
    priceText = `${jsonLd.offer.currency ?? 'USD'} ${jsonLd.offer.price}`;
    currency = jsonLd.offer.currency ?? 'USD';
  }

  if (!priceText) {
    const metaAmount =
      $('meta[property="product:price:amount"]').attr('content')?.trim() ||
      $('meta[property="og:price:amount"]').attr('content')?.trim();
    const metaCurrency =
      $('meta[property="product:price:currency"]').attr('content')?.trim() ||
      $('meta[property="og:price:currency"]').attr('content')?.trim();
    const amount = Number(metaAmount);
    if (metaAmount && Number.isFinite(amount) && amount > 0 && amount <= PRICE_MAX_PLAUSIBLE) {
      priceText = `${metaCurrency?.toUpperCase() ?? 'USD'} ${metaAmount}`;
      currency = metaCurrency?.toUpperCase() ?? undefined;
    }
  }

  if (!priceText) {
    priceText = cssPriceCandidate($);
  }

  const mpnFromPage =
    jsonLd?.mpn ||
    text($, [
      '.mpn',
      '[data-mpn]',
      '[itemprop="mpn"]',
      'td:contains("Manufacturer Part Number") + td',
      'td:contains("Mfr. Part") + td',
      'td:contains("MPN") + td',
      'li:contains("MPN")',
    ]);

  const manufacturer =
    jsonLd?.brand || text($, ['.manufacturer', '.brand', '[itemprop="brand"]']);

  // Stock quantity only when the text is actually about stock — "Ships in
  // 3 days" must not become "3 in stock".
  const stockText = text($, ['.stock', '.availability', '[itemprop="availability"]']);
  let stockQuantity: number | null = null;
  if (stockText && /\b(stock|available|availability|qty|quantity|units?|pcs)\b/i.test(stockText)) {
    const digits = stockText.replace(/,/g, '').match(/\d+/);
    const parsedQty = digits ? Number(digits[0]) : NaN;
    if (Number.isFinite(parsedQty) && parsedQty > 0) stockQuantity = parsedQty;
  }
  if (!availability && stockText && /\bin stock\b/i.test(stockText)) {
    availability = 'In stock';
  }
  if (!availability && stockText && /\bout of stock\b/i.test(stockText)) {
    availability = 'Out of stock';
  }

  // mpnHint is intentionally unused for the returned MPN — kept in signature for callers
  // that still pass the searched part for future proximity helpers.
  void mpnHint;

  return {
    mpn: mpnFromPage || undefined,
    manufacturer: manufacturer || undefined,
    description: jsonLd?.name || title,
    priceText,
    currency,
    availability: availability ?? null,
    stockQuantity,
    leadTime: text($, ['.lead-time', '.leadtime']),
    moq: null,
    country: null,
    supplierName: null,
  };
}
