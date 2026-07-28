import * as cheerio from 'cheerio';
import type { ExtractedPart } from '../types.js';

function firstText($: cheerio.CheerioAPI, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = $(selector).first().text().replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return undefined;
}

function meta($: cheerio.CheerioAPI, names: string[]): string | undefined {
  for (const name of names) {
    const content =
      $(`meta[name="${name}"]`).attr('content') ||
      $(`meta[property="${name}"]`).attr('content') ||
      $(`meta[itemprop="${name}"]`).attr('content');
    if (content?.trim()) return content.trim();
  }
  return undefined;
}

/**
 * SupplyItNow product page extractor (HTTP/Cheerio — Playwright only if profile requires it).
 */
export function extractSupplyItNowPart(html: string): ExtractedPart | null {
  const $ = cheerio.load(html);

  const jsonLdMpn = extractJsonLdMpn($);
  const mpn =
    jsonLdMpn ||
    firstText($, [
      '[data-mpn]',
      '.mpn',
      '.manufacturer-part-number',
      'td:contains("Manufacturer Part"), td:contains("MPN") + td',
      'span:contains("MPN")',
    ]) ||
    meta($, ['product:retailer_item_id', 'sku']);

  const cleanedMpn = mpn
    ?.replace(/^(MPN|Manufacturer Part Number|Part Number)\s*[:#-]?\s*/i, '')
    .trim();

  if (!cleanedMpn) return null;

  const manufacturer =
    firstText($, ['.manufacturer', '[data-manufacturer]', '.brand', 'a[href*="manufacturer"]']) ||
    meta($, ['product:brand', 'brand']);

  const description =
    firstText($, ['h1', '.product-title', '.product-name', '[data-product-title]']) ||
    meta($, ['og:title', 'description']);

  return {
    mpn: cleanedMpn,
    manufacturer: manufacturer || undefined,
    description: description || undefined,
  };
}

function extractJsonLdMpn($: cheerio.CheerioAPI): string | undefined {
  const scripts = $('script[type="application/ld+json"]');
  for (const el of scripts.toArray()) {
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const record = node as Record<string, unknown>;
        const mpn = record.mpn || record.sku || record.productID;
        if (typeof mpn === 'string' && mpn.trim()) return mpn.trim();
      }
    } catch {
      // ignore invalid json-ld blocks
    }
  }
  return undefined;
}
