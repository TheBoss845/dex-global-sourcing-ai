import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { INTEGRATIONS_FETCH_POLICY } from './index.js';

describe('integrations', () => {
  it('is http-first', () => {
    assert.equal(INTEGRATIONS_FETCH_POLICY, 'http-first');
  });
});
