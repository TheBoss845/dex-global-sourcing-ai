import type { BatchItemInput } from './schema.js';

const CATEGORY_WORDS = ['information technology', 'renewable', 'medical'];

/** Lines from marketplace UIs that carry no part data. */
const NOISE_LINE =
  /^(qty|price|lowest auto quote|condition|currency|quote now|best offer)\s*:?/i;

const MAX_ITEMS = 50;

function looksLikePartNumber(value: string): boolean {
  if (value.length < 2 || value.length > 80) return false;
  if (/^(\$|€|£)/.test(value)) return false;
  if (/best offer|quote now|immediate|working|defective|hours?|days?|minutes?/i.test(value)) {
    return false;
  }
  return /[A-Za-z0-9]/.test(value);
}

function pushItem(items: BatchItemInput[], item: BatchItemInput) {
  const key = item.mpn.toUpperCase();
  if (items.some((existing) => existing.mpn.toUpperCase() === key)) return;
  items.push(item);
}

/**
 * Parse a pasted parts list into structured items. Understands:
 *  1. SupplyItNow marketplace rows (tab-separated:
 *     [Manufacturer] <tab> Category <tab> PART <tab> DESCRIPTION <tab> qty ...)
 *  2. Generic tab-separated "PART <tab> description" lines
 *  3. Simple "PART, description" or bare part-number lines
 * Noise rows (Qty:/Price:/Currency: etc.) are ignored.
 */
export function parsePastedPartsList(text: string): BatchItemInput[] {
  const items: BatchItemInput[] = [];

  for (const rawLine of text.split('\n')) {
    if (items.length >= MAX_ITEMS) break;
    const line = rawLine.replace(/\u00a0/g, ' ').trim();
    if (!line || NOISE_LINE.test(line)) continue;

    if (line.includes('\t')) {
      const cells = line
        .split('\t')
        .map((cell) => cell.trim())
        .filter(Boolean);
      if (cells.length === 0) continue;

      // Marketplace row: locate the category cell; part number follows it.
      const catIdx = cells.findIndex((cell) =>
        CATEGORY_WORDS.some((cat) => cell.toLowerCase().startsWith(cat)),
      );
      if (catIdx !== -1 && cells.length > catIdx + 2) {
        const manufacturer = catIdx > 0 ? cells.slice(0, catIdx).join(' ').trim() : undefined;
        const mpn = cells[catIdx + 1]!;
        const description = cells[catIdx + 2];
        if (looksLikePartNumber(mpn)) {
          pushItem(items, {
            mpn,
            description: description && description.length > 1 ? description : undefined,
            manufacturer: manufacturer || undefined,
          });
          continue;
        }
      }

      // Generic tab line: first plausible cell is the part, next is description.
      const [first, ...rest] = cells;
      if (first && looksLikePartNumber(first)) {
        pushItem(items, {
          mpn: first,
          description: rest.length ? rest.join(' ').slice(0, 300) : undefined,
        });
      }
      continue;
    }

    // "PART, description" or a bare part number.
    const commaIdx = line.indexOf(',');
    if (commaIdx > 0) {
      const mpn = line.slice(0, commaIdx).trim();
      const description = line.slice(commaIdx + 1).trim();
      if (looksLikePartNumber(mpn)) {
        pushItem(items, { mpn, description: description || undefined });
      }
      continue;
    }

    if (looksLikePartNumber(line)) {
      pushItem(items, { mpn: line });
    }
  }

  return items;
}
