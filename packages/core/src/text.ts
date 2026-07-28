/** Clean scraped/AI text for display: HTML entities, mojibake, stray markup. */
export function cleanDisplayText(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let text = raw;

  // Numeric HTML entities (&#39; &#x27; ...)
  text = text.replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
    const code = Number.parseInt(hex, 16);
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
  });
  text = text.replace(/&#(\d+);/g, (_, dec) => {
    const code = Number.parseInt(dec, 10);
    return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
  });

  // Named entities commonly seen on product pages
  const named: Record<string, string> = {
    '&amp;': '&',
    '&quot;': '"',
    '&apos;': "'",
    '&lt;': '<',
    '&gt;': '>',
    '&nbsp;': ' ',
    '&trade;': '™',
    '&reg;': '®',
    '&copy;': '©',
    '&deg;': '°',
    '&plusmn;': '±',
    '&micro;': 'µ',
    '&ndash;': '–',
    '&mdash;': '—',
  };
  text = text.replace(/&[a-z]+;/gi, (entity) => named[entity.toLowerCase()] ?? entity);

  // Common UTF-8-as-Latin-1 mojibake
  text = text
    .replaceAll('â€™', '’')
    .replaceAll('â€œ', '“')
    .replaceAll('â€\u009d', '”')
    .replaceAll('â€\u201d', '—')
    .replaceAll('â€\u201c', '–')
    .replaceAll('â€"', '–')
    .replaceAll('â€¦', '…')
    .replaceAll('Â', '');

  // Stray markdown/markup and control characters
  text = text
    .replace(/[*_`#]+/g, '')
    .replace(/<[^>]+>/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f\ufffd]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text || undefined;
}
