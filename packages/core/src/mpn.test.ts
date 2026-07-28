import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mpnsMatch, normalizeMpn } from './mpn.js';

describe('normalizeMpn', () => {
  it('strips separators and uppercases', () => {
    assert.equal(normalizeMpn(' ab-12.34/x '), 'AB1234X');
  });

  it('matches equivalent forms', () => {
    assert.equal(mpnsMatch('LM7805CT', 'lm-7805-ct'), true);
    assert.equal(mpnsMatch('LM7805CT', 'LM7806CT'), false);
  });
});
