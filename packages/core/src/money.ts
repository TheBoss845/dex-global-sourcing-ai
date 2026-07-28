// Multi-character symbols must be checked before the bare '$' so that
// "C$10" parses as CAD, not USD.
const CURRENCY_SYMBOLS: Array<[string, string]> = [
  ['US$', 'USD'],
  ['HK$', 'HKD'],
  ['NT$', 'TWD'],
  ['A$', 'AUD'],
  ['C$', 'CAD'],
  ['S$', 'SGD'],
  ['R$', 'BRL'],
  ['$', 'USD'],
  ['€', 'EUR'],
  ['£', 'GBP'],
  ['¥', 'JPY'],
  ['₹', 'INR'],
  ['₩', 'KRW'],
  ['₽', 'RUB'],
];

// Only accept real ISO codes — otherwise words like "USA" or "NEW" get
// mistaken for currencies and the USD conversion silently fails.
const ISO_CURRENCIES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CNY', 'KRW', 'INR', 'CAD', 'AUD', 'SGD', 'HKD',
  'TWD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'RUB', 'BRL',
  'MXN', 'TRY', 'ZAR', 'ILS', 'AED', 'SAR', 'THB', 'MYR', 'IDR', 'PHP', 'VND', 'NZD',
]);

const MAX_PLAUSIBLE_AMOUNT = 500_000;

export type ParsedMoney = {
  amount: number;
  currency: string;
};

/**
 * Best-effort parse of messy price strings from product pages.
 * Returns null rather than guessing when the string is not a plausible price.
 */
export function parseMoney(raw: string, fallbackCurrency = 'USD'): ParsedMoney | null {
  const text = raw.replace(/\u00a0/g, ' ').trim();
  if (!text) return null;

  let currency = fallbackCurrency;
  for (const [symbol, code] of CURRENCY_SYMBOLS) {
    if (text.includes(symbol)) {
      currency = code;
      break;
    }
  }

  const codeMatch = text.toUpperCase().match(/\b([A-Z]{3})\b/);
  if (codeMatch?.[1] && ISO_CURRENCIES.has(codeMatch[1])) currency = codeMatch[1];

  const amountMatch = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[0]);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PLAUSIBLE_AMOUNT) return null;
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
