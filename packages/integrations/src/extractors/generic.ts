import * as cheerio from 'cheerio';
import type { OfferDraft } from '../types.js';

function text($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = $(selector).first().text().replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return undefined;
}

/**
 * Generic HTTP extractor for long-tail supplier pages.
 * Site-specific adapters should replace this when available.
 *
 * @param mpnHint optional search MPN used only to locate price/stock near a match —
 *   never returned as the page's extracted MPN (that caused false-positive offers).
 */
export function extractGenericOffer(html: string, mpnHint?: string): OfferDraft {
  const $ = cheerio.load(html);
  const title = text($, ['h1', 'title', '[property="og:title"]']) || undefined;
  const priceText =
    text($, [
      '[itemprop="price"]',
      '.price',
      '.product-price',
      '[data-price]',
      'span:contains("$")',
    ]) || undefined;

  const mpnFromPage = text($, [
    '.mpn',
    '[data-mpn]',
    '[itemprop="mpn"]',
    'td:contains("Manufacturer Part Number") + td',
    'td:contains("Mfr. Part") + td',
    'td:contains("MPN") + td',
    'li:contains("MPN")',
  ]);

  const manufacturer = text($, ['.manufacturer', '.brand', '[itemprop="brand"]']);
  const stockText = text($, ['.stock', '.availability', '[itemprop="availability"]']);
  const stockQuantity = stockText ? Number(stockText.replace(/[^\d]/g, '')) : null;

  // mpnHint is intentionally unused for the returned MPN — kept in signature for callers
  // that still pass the searched part for future proximity helpers.
  void mpnHint;

  return {
    mpn: mpnFromPage || undefined,
    manufacturer: manufacturer || undefined,
    description: title,
    priceText,
    stockQuantity: Number.isFinite(stockQuantity) ? stockQuantity : null,
    leadTime: text($, ['.lead-time', '.leadtime']),
    moq: null,
    country: null,
    supplierName: null,
  };
}
