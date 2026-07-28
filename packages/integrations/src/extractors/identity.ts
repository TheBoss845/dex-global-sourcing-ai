import * as cheerio from 'cheerio';

export type IdentityClass =
  | 'mpn'
  | 'sku'
  | 'model'
  | 'stock'
  | 'catalog'
  | 'brand'
  | 'manufacturer'
  | 'title'
  | 'description'
  | 'unknown';

export type IdentityEvidence = {
  value: string;
  classification: IdentityClass;
  source: 'json_ld' | 'og' | 'meta' | 'labeled_dom' | 'adapter' | 'heuristic';
  path: string;
  score: number;
};

export type PartIdentityDraft = {
  manufacturer?: string;
  brand?: string;
  mpn?: string;
  modelNumber?: string;
  supplierSku?: string;
  title?: string;
  description?: string;
  specifications?: Record<string, string>;
  evidence: IdentityEvidence[];
  method: string;
};

const MPN_LABELS =
  /^(manufacturer\s*part\s*(number|#|no\.?)|mfr\.?\s*part\s*(number|#|no\.?)|mfr\.?\s*#|mpn|orderable\s*part|manufacturer\s*#)$/i;
const SKU_LABELS =
  /^(sku|supplier\s*part\s*(number|#)?|distributor\s*part|order\s*code|part\s*number|item\s*number|stock\s*(number|#)|catalog\s*(number|#)|cat\.?\s*#)$/i;
const MFG_LABELS = /^(manufacturer|mfr\.?|brand|vendor)$/i;
const MODEL_LABELS = /^(model|model\s*(number|#))$/i;

function pushEvidence(
  evidence: IdentityEvidence[],
  value: string | undefined,
  classification: IdentityClass,
  source: IdentityEvidence['source'],
  path: string,
  score: number,
) {
  const cleaned = value?.replace(/\s+/g, ' ').trim();
  if (!cleaned) return;
  evidence.push({ value: cleaned, classification, source, path, score });
}

function readJsonLd($: cheerio.CheerioAPI): IdentityEvidence[] {
  const evidence: IdentityEvidence[] = [];
  $('script[type="application/ld+json"]').each((idx, el) => {
    const raw = $(el).contents().text();
    try {
      const parsed = JSON.parse(raw) as unknown;
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const [nIdx, node] of nodes.entries()) {
        if (!node || typeof node !== 'object') continue;
        const record = node as Record<string, unknown>;
        const types = record['@type'];
        const typeOk =
          types == null ||
          types === 'Product' ||
          (Array.isArray(types) && types.includes('Product'));
        if (!typeOk && record.mpn == null && record.sku == null) continue;

        if (typeof record.mpn === 'string') {
          pushEvidence(evidence, record.mpn, 'mpn', 'json_ld', `ld[${idx}].${nIdx}.mpn`, 0.92);
        }
        if (typeof record.sku === 'string') {
          pushEvidence(evidence, record.sku, 'sku', 'json_ld', `ld[${idx}].${nIdx}.sku`, 0.55);
        }
        if (typeof record.model === 'string') {
          pushEvidence(evidence, record.model, 'model', 'json_ld', `ld[${idx}].${nIdx}.model`, 0.5);
        }
        if (typeof record.name === 'string') {
          pushEvidence(evidence, record.name, 'title', 'json_ld', `ld[${idx}].${nIdx}.name`, 0.35);
        }
        if (typeof record.description === 'string') {
          pushEvidence(
            evidence,
            record.description,
            'description',
            'json_ld',
            `ld[${idx}].${nIdx}.description`,
            0.2,
          );
        }
        const brand = record.brand;
        if (typeof brand === 'string') {
          pushEvidence(evidence, brand, 'brand', 'json_ld', `ld[${idx}].${nIdx}.brand`, 0.7);
        } else if (brand && typeof brand === 'object' && typeof (brand as { name?: string }).name === 'string') {
          pushEvidence(
            evidence,
            (brand as { name: string }).name,
            'brand',
            'json_ld',
            `ld[${idx}].${nIdx}.brand.name`,
            0.7,
          );
        }
        const mfr = record.manufacturer;
        if (typeof mfr === 'string') {
          pushEvidence(evidence, mfr, 'manufacturer', 'json_ld', `ld[${idx}].${nIdx}.manufacturer`, 0.75);
        } else if (mfr && typeof mfr === 'object' && typeof (mfr as { name?: string }).name === 'string') {
          pushEvidence(
            evidence,
            (mfr as { name: string }).name,
            'manufacturer',
            'json_ld',
            `ld[${idx}].${nIdx}.manufacturer.name`,
            0.75,
          );
        }
      }
    } catch {
      // ignore invalid blocks
    }
  });
  return evidence;
}

function readMeta($: cheerio.CheerioAPI): IdentityEvidence[] {
  const evidence: IdentityEvidence[] = [];
  const ogTitle = $('meta[property="og:title"]').attr('content');
  pushEvidence(evidence, ogTitle, 'title', 'og', 'og:title', 0.3);
  const ogDesc = $('meta[property="og:description"]').attr('content');
  pushEvidence(evidence, ogDesc, 'description', 'og', 'og:description', 0.15);
  const brand = $('meta[property="product:brand"]').attr('content');
  pushEvidence(evidence, brand, 'brand', 'meta', 'product:brand', 0.65);
  const retailerId = $('meta[property="product:retailer_item_id"]').attr('content');
  pushEvidence(evidence, retailerId, 'sku', 'meta', 'product:retailer_item_id', 0.45);
  return evidence;
}

function readLabeledDom($: cheerio.CheerioAPI): IdentityEvidence[] {
  const evidence: IdentityEvidence[] = [];

  $('th, dt, span, div, li, td, label').each((_, el) => {
    const label = $(el).clone().children().remove().end().text().replace(/\s+/g, ' ').trim();
    if (!label || label.length > 64) return;

    let value =
      $(el).next('td, dd, span, div').first().text().replace(/\s+/g, ' ').trim() ||
      $(el).parent().find('td, dd').last().text().replace(/\s+/g, ' ').trim();

    if (!value || value === label) {
      const m = label.match(/^(.+?)[:#]\s*(.+)$/);
      if (m) {
        value = m[2]!.trim();
      }
    }
    if (!value || value.length > 120) return;

    const compact = label.replace(/[:#]\s*$/, '').trim();
    if (MPN_LABELS.test(compact)) {
      pushEvidence(evidence, value, 'mpn', 'labeled_dom', `label:${compact}`, 0.88);
    } else if (MFG_LABELS.test(compact)) {
      pushEvidence(evidence, value, 'manufacturer', 'labeled_dom', `label:${compact}`, 0.72);
    } else if (MODEL_LABELS.test(compact)) {
      pushEvidence(evidence, value, 'model', 'labeled_dom', `label:${compact}`, 0.5);
    } else if (SKU_LABELS.test(compact)) {
      pushEvidence(evidence, value, 'sku', 'labeled_dom', `label:${compact}`, 0.5);
    }
  });

  return evidence;
}

function pickBest(evidence: IdentityEvidence[], classification: IdentityClass): string | undefined {
  const matches = evidence
    .filter((row) => row.classification === classification)
    .sort((a, b) => {
      if (classification === 'mpn') {
        const aN = a.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const bN = b.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (aN !== bN && aN.includes(bN) && a.score >= b.score - 0.25) return -1;
        if (aN !== bN && bN.includes(aN) && b.score >= a.score - 0.25) return 1;
      }
      if (b.score !== a.score) return b.score - a.score;
      return b.value.length - a.value.length;
    });
  return matches[0]?.value;
}

function readUrlPathHints(pageUrl: string | undefined, html: string): IdentityEvidence[] {
  if (!pageUrl) return [];
  const evidence: IdentityEvidence[] = [];
  try {
    const path = new URL(pageUrl).pathname;
    const segments = path.split('/').filter(Boolean);
    const candidates = [...segments].reverse().slice(0, 4);
    const upperHtml = html.toUpperCase();
    for (const seg of candidates) {
      const decoded = decodeURIComponent(seg).split('?')[0] ?? '';
      // Skip pure numeric ids and very short tokens; prefer part-like tokens.
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,47}$/.test(decoded)) continue;
      if (/^\d+$/.test(decoded)) continue;
      if (['product', 'products', 'product-detail', 'en', 'detail'].includes(decoded.toLowerCase())) {
        continue;
      }
      if (!upperHtml.includes(decoded.toUpperCase())) continue;
      // Prefer longer path tokens over short family names in JSON-LD.
      const score = Math.min(0.9, 0.7 + decoded.length * 0.015);
      pushEvidence(evidence, decoded, 'mpn', 'heuristic', `url.path:${decoded}`, score);
    }
  } catch {
    // ignore bad URLs
  }
  return evidence;
}

/**
 * Generic product-page identity extraction (HTTP HTML).
 * Site adapters can pre-seed higher-confidence evidence.
 */
export function extractProductIdentity(
  html: string,
  options?: {
    adapterDraft?: Partial<PartIdentityDraft>;
    method?: string;
    pageUrl?: string;
    finalUrl?: string;
  },
): PartIdentityDraft {
  const $ = cheerio.load(html);
  const evidence: IdentityEvidence[] = [
    ...(options?.adapterDraft?.evidence ?? []),
    ...readJsonLd($),
    ...readMeta($),
    ...readLabeledDom($),
    ...readUrlPathHints(options?.pageUrl, html),
    ...readUrlPathHints(options?.finalUrl, html),
  ];

  const title =
    options?.adapterDraft?.title ||
    pickBest(evidence, 'title') ||
    $('h1').first().text().replace(/\s+/g, ' ').trim() ||
    $('title').first().text().replace(/\s+/g, ' ').trim();

  if (title) {
    pushEvidence(evidence, title, 'title', 'heuristic', 'h1|title', 0.25);
  }

  const description =
    options?.adapterDraft?.description ||
    pickBest(evidence, 'description') ||
    $('meta[name="description"]').attr('content')?.trim();

  const manufacturer =
    options?.adapterDraft?.manufacturer ||
    pickBest(evidence, 'manufacturer') ||
    pickBest(evidence, 'brand');

  const brand = options?.adapterDraft?.brand || pickBest(evidence, 'brand') || manufacturer;
  const mpn = options?.adapterDraft?.mpn || pickBest(evidence, 'mpn');
  const supplierSku = options?.adapterDraft?.supplierSku || pickBest(evidence, 'sku');
  const modelNumber = options?.adapterDraft?.modelNumber || pickBest(evidence, 'model');

  return {
    manufacturer,
    brand,
    mpn,
    modelNumber,
    supplierSku,
    title,
    description,
    specifications: options?.adapterDraft?.specifications,
    evidence,
    method: options?.method ?? options?.adapterDraft?.method ?? 'generic',
  };
}
