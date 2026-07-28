import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../errors.js';
import {
  assertSafeUrl,
  extractRegistrableDomain,
  isBlockedHostnameOrIp,
} from './url.js';

describe('assertSafeUrl', () => {
  it('allows public https URLs', () => {
    const url = assertSafeUrl('https://www.digikey.com/product/123', { allowHttp: true });
    assert.equal(url.hostname, 'www.digikey.com');
  });

  it('allows http when enabled', () => {
    const url = assertSafeUrl('http://example.com/p/1', { allowHttp: true });
    assert.equal(url.protocol, 'http:');
  });

  it('blocks localhost', () => {
    assert.throws(
      () => assertSafeUrl('http://localhost/x', { allowHttp: true }),
      (err: unknown) => err instanceof AppError && err.code === 'SSRF_BLOCKED',
    );
  });

  it('blocks private IPs', () => {
    assert.throws(
      () => assertSafeUrl('https://127.0.0.1/'),
      (err: unknown) => err instanceof AppError && err.code === 'SSRF_BLOCKED',
    );
  });

  it('blocks metadata IP literal', () => {
    assert.equal(isBlockedHostnameOrIp('169.254.169.254'), true);
  });
});

describe('extractRegistrableDomain', () => {
  it('handles common and multi-part TLDs', () => {
    assert.equal(extractRegistrableDomain('www.digikey.com'), 'digikey.com');
    assert.equal(extractRegistrableDomain('www.ebay.co.uk'), 'ebay.co.uk');
    assert.equal(extractRegistrableDomain('shop.example.co.in'), 'example.co.in');
  });
});
