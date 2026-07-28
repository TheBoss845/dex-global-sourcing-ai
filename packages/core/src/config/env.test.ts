import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('parses required variables', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgresql://dex:dex@localhost:5432/dex',
      REDIS_URL: 'redis://localhost:6379',
      AI_ENABLED: 'true',
    });
    assert.equal(env.AI_ENABLED, true);
    assert.equal(env.RESULT_LIMIT, 10);
  });

  it('throws when DATABASE_URL missing', () => {
    assert.throws(() => loadEnv({ REDIS_URL: 'redis://localhost:6379' }), /DATABASE_URL/);
  });
});
