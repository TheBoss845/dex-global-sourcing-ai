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

  const mpnFromPage =
    text($, ['.mpn', '[data-mpn]', 'td:contains("MPN") + td', 'li:contains("MPN")']) || mpnHint;

  const manufacturer = text($, ['.manufacturer', '.brand', '[itemprop="brand"]']);
  const stockText = text($, ['.stock', '.availability', '[itemprop="availability"]']);
  const stockQuantity = stockText ? Number(stockText.replace(/[^\d]/g, '')) : null;

  return {
    mpn: mpnFromPage,
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
