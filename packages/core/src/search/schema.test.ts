import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSearchSchema } from './schema.js';

describe('createSearchSchema', () => {
  it('requires a valid URL', () => {
    assert.equal(createSearchSchema.safeParse({ url: 'not-a-url' }).success, false);
    assert.equal(createSearchSchema.safeParse({}).success, false);
    assert.equal(
      createSearchSchema.safeParse({ url: 'https://www.sparkfun.com/products/127' }).success,
      true,
    );
  });

  it('defaults forceRefresh to false', () => {
    const parsed = createSearchSchema.parse({ url: 'https://example.com/p/1' });
    assert.equal(parsed.forceRefresh, false);
  });
});
