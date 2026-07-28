import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAiEnabled } from './index.js';

describe('isAiEnabled', () => {
  it('requires flag and key', () => {
    assert.equal(isAiEnabled({}), false);
    assert.equal(isAiEnabled({ AI_ENABLED: 'true' }), false);
    assert.equal(isAiEnabled({ AI_ENABLED: 'true', OPENAI_API_KEY: 'sk-test' }), true);
  });
});
