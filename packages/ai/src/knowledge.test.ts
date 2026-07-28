import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canonicalManufacturer,
  categorizePart,
  expandShorthand,
  sameManufacturer,
  buildDomainContext,
} from './knowledge.js';

describe('domain knowledge', () => {
  it('resolves manufacturer aliases to one identity', () => {
    assert.ok(sameManufacturer('TI', 'Texas Instruments'));
    assert.ok(sameManufacturer('Compaq-Hewlett Packard', 'HP'));
    assert.ok(sameManufacturer('HPE', 'Hewlett Packard'));
    assert.ok(sameManufacturer('Allen-Bradley', 'Rockwell Automation'));
    assert.ok(sameManufacturer('Crompton Instruments', 'TE Connectivity'));
    assert.ok(sameManufacturer('DEX', 'Data Exchange Corp.'));
    assert.ok(sameManufacturer('Vectron', 'Bonfiglioli'));
    assert.ok(!sameManufacturer('ABB', 'Siemens'));
    assert.ok(!sameManufacturer('Dell', 'Lenovo'));
  });

  it('canonicalizes unknown names to their normalized form', () => {
    assert.equal(canonicalManufacturer('SomeNewVendor Ltd.'), 'SOMENEWVENDORLTD');
  });

  it('expands catalog shorthand without destroying part numbers', () => {
    const expanded = expandShorthand('ASSY,BZL,FRT,5860T');
    assert.ok(expanded.includes('assembly'));
    assert.ok(expanded.includes('bezel'));
    assert.ok(expanded.includes('front'));
    assert.ok(expanded.includes('5860T'));
  });

  it('categorizes parts with sensible price bands', () => {
    const breaker = categorizePart('CIRCUIT BREAKER, 0.63-1A, MS325-1.0');
    assert.equal(breaker?.id, 'breaker-electrical');

    const drive = categorizePart('ACS800N, INVERTER');
    assert.equal(drive?.id, 'drive-inverter');

    const laptop = categorizePart('HINGE L 80Y8 W/ANTENNA notebook');
    assert.equal(laptop?.id, 'it-hardware');

    const pi = categorizePart('Raspberry Pi Zero v1.3 single board computer');
    assert.equal(pi?.id, 'sbc-maker');
  });

  it('builds a domain context block for prompts', () => {
    const ctx = buildDomainContext({
      mpn: 'ACS800N-104LC-0950-7+E205',
      manufacturer: 'Abb',
      description: 'ACS800N, INVERTER',
    });
    assert.ok(ctx.includes('DOMAIN KNOWLEDGE'));
    assert.ok(ctx.includes('Drives, inverters'));
    assert.ok(ctx.includes('canonical: ABB'));
  });
});
