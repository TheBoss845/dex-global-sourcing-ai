const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₩': 'KRW',
  '₽': 'RUB',
  A$: 'AUD',
  C$: 'CAD',
  HK$: 'HKD',
  S$: 'SGD',
  R$: 'BRL',
  NT$: 'TWD',
};

export type ParsedMoney = {
  amount: number;
  currency: string;
};

/**
 * Best-effort parse of messy price strings from product pages.
 */
export function parseMoney(raw: string, fallbackCurrency = 'USD'): ParsedMoney | null {
  const text = raw.replace(/\u00a0/g, ' ').trim();
  if (!text) return null;

  let currency = fallbackCurrency;
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (text.includes(symbol)) {
      currency = code;
      break;
    }
  }

  const codeMatch = text.match(/\b([A-Z]{3})\b/);
  if (codeMatch?.[1]) currency = codeMatch[1];

  const amountMatch = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[0]);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency };
}

export async function fetchUsdRates(baseCurrencies: string[]): Promise<Map<string, number>> {
  const unique = [...new Set(baseCurrencies.map((c) => c.toUpperCase()).filter((c) => c !== 'USD'))];
  const rates = new Map<string, number>([['USD', 1]]);
  if (unique.length === 0) return rates;

  // Frankfurter free API — deterministic FX, no API key.
  const url = `https://api.frankfurter.app/latest?from=USD&to=${unique.join(',')}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`FX provider failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { rates: Record<string, number> };
  for (const currency of unique) {
    const perUsd = data.rates[currency];
    if (perUsd && perUsd > 0) {
      rates.set(currency, 1 / perUsd);
    }
  }
  return rates;
}

export function toUsd(amount: number, currency: string, rates: Map<string, number>): number | null {
  const code = currency.toUpperCase();
  const rate = rates.get(code);
  if (rate == null) return null;
  return amount * rate;
}
