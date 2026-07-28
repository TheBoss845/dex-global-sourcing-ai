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

  it('blocks unsupported protocols', () => {
    assert.throws(
      () => assertSafeUrl('file:///etc/passwd'),
      (err: unknown) => err instanceof AppError && err.code === 'SSRF_BLOCKED',
    );
    assert.throws(
      () => assertSafeUrl('ftp://example.com/x'),
      (err: unknown) => err instanceof AppError,
    );
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
    assert.throws(
      () => assertSafeUrl('http://10.0.0.5/'),
      (err: unknown) => err instanceof AppError && err.code === 'SSRF_BLOCKED',
    );
    assert.throws(
      () => assertSafeUrl('http://192.168.1.10/'),
      (err: unknown) => err instanceof AppError && err.code === 'SSRF_BLOCKED',
    );
    assert.throws(
      () => assertSafeUrl('http://172.16.0.1/'),
      (err: unknown) => err instanceof AppError && err.code === 'SSRF_BLOCKED',
    );
  });

  it('blocks metadata IP literal', () => {
    assert.equal(isBlockedHostnameOrIp('169.254.169.254'), true);
    assert.throws(
      () => assertSafeUrl('http://169.254.169.254/latest/meta-data'),
      (err: unknown) => err instanceof AppError && err.code === 'SSRF_BLOCKED',
    );
  });

  it('blocks malformed URLs', () => {
    assert.throws(
      () => assertSafeUrl('not a url'),
      (err: unknown) => err instanceof AppError && err.code === 'VALIDATION_ERROR',
    );
  });
});

describe('extractRegistrableDomain', () => {
  it('handles common and multi-part TLDs', () => {
    assert.equal(extractRegistrableDomain('www.digikey.com'), 'digikey.com');
    assert.equal(extractRegistrableDomain('www.ebay.co.uk'), 'ebay.co.uk');
    assert.equal(extractRegistrableDomain('shop.example.co.in'), 'example.co.in');
  });
});
