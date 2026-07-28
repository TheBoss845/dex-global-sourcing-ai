import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../errors.js';
import { assertSafeUrl } from './url.js';

describe('assertSafeUrl', () => {
  it('allows https allowlisted hosts', () => {
    const url = assertSafeUrl('https://www.supplyitnow.com/product/123', {
      allowedHosts: ['supplyitnow.com'],
    });
    assert.equal(url.hostname, 'www.supplyitnow.com');
  });

  it('blocks private IPs', () => {
    assert.throws(
      () => assertSafeUrl('https://127.0.0.1/'),
      (err: unknown) => err instanceof AppError && err.code === 'SSRF_BLOCKED',
    );
  });

  it('blocks non-allowlisted hosts when allowlist set', () => {
    assert.throws(
      () =>
        assertSafeUrl('https://evil.example/x', {
          allowedHosts: ['supplyitnow.com'],
        }),
      (err: unknown) => err instanceof AppError && err.code === 'SSRF_BLOCKED',
    );
  });
});
