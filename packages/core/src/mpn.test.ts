import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mpnsMatch, normalizeMpn } from './mpn.js';

describe('normalizeMpn', () => {
  it('strips separators and uppercases', () => {
    assert.equal(normalizeMpn(' lm-7805.ct '), 'LM7805CT');
    assert.equal(normalizeMpn('LM_7805/CT'), 'LM7805CT');
  });

  it('matches equivalent forms', () => {
    assert.equal(mpnsMatch('lm-7805ct', 'LM7805CT'), true);
    assert.equal(mpnsMatch('LM7805CT', 'LM7805'), false);
    assert.equal(mpnsMatch('UA7805', 'UA78'), false);
  });

  it('handles whitespace and punctuation', () => {
    assert.equal(normalizeMpn('\tPRT-00127\n'), 'PRT00127');
    assert.equal(mpnsMatch('PRT-00127', 'prt00127'), true);
  });

  it('rejects empty after normalization', () => {
    assert.equal(normalizeMpn('---'), '');
    assert.equal(mpnsMatch('', 'ABC'), false);
  });
});
