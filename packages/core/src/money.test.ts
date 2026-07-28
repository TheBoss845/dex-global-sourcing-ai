import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseMoney, toUsd } from './money.js';

describe('parseMoney', () => {
  it('parses USD and EUR amounts', () => {
    assert.deepEqual(parseMoney('$1,234.50'), { amount: 1234.5, currency: 'USD' });
    assert.equal(parseMoney('EUR 12.00')?.currency, 'EUR');
    assert.equal(parseMoney('€9.99')?.amount, 9.99);
  });

  it('returns null for non-prices', () => {
    assert.equal(parseMoney('n/a'), null);
    assert.equal(parseMoney(''), null);
  });

  it('converts using provided rates', () => {
    const rates = new Map([
      ['USD', 1],
      ['EUR', 1.1],
    ]);
    assert.equal(toUsd(10, 'EUR', rates), 11);
    assert.equal(toUsd(5, 'USD', rates), 5);
    assert.equal(toUsd(5, 'JPY', rates), null);
  });
});
