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

const EMAIL_JUNK =
  /(no-?reply|donotreply|example\.|sentry|wixpress|\.png|\.jpg|\.gif|\.webp|schema\.org|yourdomain|domain\.com|email\.com|test@)/i;

/** Preferred sales-contact prefixes, best first. */
const EMAIL_PREFERENCE = ['sales', 'quote', 'rfq', 'order', 'info', 'contact', 'support', 'hello'];

/**
 * Best-effort sales/contact email from a vendor page. mailto: links are the
 * strongest signal; falls back to visible-text addresses. Junk (no-reply,
 * placeholders, asset names) is filtered and sales-type inboxes win.
 */
export function extractContactEmail(html: string): string | undefined {
  const emails = new Set<string>();

  for (const match of html.matchAll(/mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi)) {
    emails.add(match[1]!.toLowerCase());
  }
  // Cap the plain-text scan so giant pages stay fast.
  const text = html.slice(0, 400_000);
  for (const match of text.matchAll(/\b([a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/gi)) {
    emails.add(match[1]!.toLowerCase());
  }

  const candidates = [...emails].filter(
    (email) => email.length <= 60 && !EMAIL_JUNK.test(email),
  );
  if (candidates.length === 0) return undefined;

  for (const prefix of EMAIL_PREFERENCE) {
    const hit = candidates.find((email) => email.startsWith(prefix));
    if (hit) return hit;
  }
  return candidates[0];
}

/**
 * Extract the main product photo URL from a page (JSON-LD image, OpenGraph,
 * twitter card, itemprop, or link rel). Returns an absolute http(s) URL.
 */
export function extractProductImage(html: string, baseUrl?: string): string | undefined {
  const $ = cheerio.load(html);

  const candidates: Array<string | undefined> = [];

  // JSON-LD Product.image (string | string[] | ImageObject)
  $('script[type="application/ld+json"]').each((_, el) => {
    const rawText = $(el).contents().text();
    if (!rawText.trim()) return;
    try {
      const parsed = JSON.parse(rawText) as unknown;
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const node = asRecord(queue.shift());
        if (!node) continue;
        if (Array.isArray(node['@graph'])) queue.push(...(node['@graph'] as unknown[]));
        const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
        if (!types.includes('Product')) continue;
        const image = node.image;
        if (typeof image === 'string') candidates.push(image);
        else if (Array.isArray(image) && typeof image[0] === 'string') candidates.push(image[0]);
        else if (typeof asRecord(image)?.url === 'string') candidates.push(asRecord(image)!.url as string);
      }
    } catch {
      // ignore invalid JSON-LD
    }
  });

  candidates.push(
    $('meta[property="og:image:secure_url"]').attr('content')?.trim(),
    $('meta[property="og:image"]').attr('content')?.trim(),
    $('meta[name="twitter:image"]').attr('content')?.trim(),
    $('[itemprop="image"]').attr('content')?.trim() || $('[itemprop="image"]').attr('src')?.trim(),
    $('link[rel="image_src"]').attr('href')?.trim(),
  );

  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const resolved = baseUrl ? new URL(raw, baseUrl).toString() : new URL(raw).toString();
      if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
        return resolved.slice(0, 600);
      }
    } catch {
      // try next candidate
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
