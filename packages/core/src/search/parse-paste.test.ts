import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parsePastedPartsList } from './parse-paste.js';

const SUPPLYITNOW_PASTE = `Information Technology  \t5H50Q59904\tHINGE L 80Y8 W/ANTENNA\t7\t$Best Offer\tImmediate\t\tQuote Now\tWorking (New or Used)\t1891374\t
Qty:\t
Price:\t
Lowest Auto Quote:\t
Condition:\t
Currency:\tUS dollar
Abb \tRenewable  \tACS800N-104LC-0950-7+E205\tACS800N, INVERTER\t50\t$Best Offer\t07/31/2026\t1403 Days, 1 Hour\tQuote Now\tDefective\t2121358\t
Qty:\t
Currency:\tUS dollar
Dell \tInformation Technology  \tMYHV5\tASSY,BZL,FRT,5860T\t1\t$Best Offer\tImmediate\t5 Hours, 50 Minutes\tQuote Now\tWorking (New or Used)\t2249250\t
Data Exchange Corp. \tRenewable  \tDEX-25W22KJ-532\tRESISTOR FOR ELECTRONIC CIRCUITS OF THE IGBT 390 KW MODULE\t40\t$Best Offer\tImmediate\t14 Hours, 53 Minutes\tQuote Now\tWorking (New or Used)\t2254658\t`;

describe('parsePastedPartsList', () => {
  it('parses SupplyItNow marketplace rows with manufacturer and description', () => {
    const items = parsePastedPartsList(SUPPLYITNOW_PASTE);
    assert.equal(items.length, 4);

    assert.equal(items[0]!.mpn, '5H50Q59904');
    assert.equal(items[0]!.description, 'HINGE L 80Y8 W/ANTENNA');
    assert.equal(items[0]!.manufacturer, undefined);

    assert.equal(items[1]!.mpn, 'ACS800N-104LC-0950-7+E205');
    assert.equal(items[1]!.manufacturer, 'Abb');

    assert.equal(items[2]!.mpn, 'MYHV5');
    assert.equal(items[2]!.manufacturer, 'Dell');
    assert.equal(items[2]!.description, 'ASSY,BZL,FRT,5860T');

    assert.equal(items[3]!.mpn, 'DEX-25W22KJ-532');
    assert.equal(items[3]!.manufacturer, 'Data Exchange Corp.');
  });

  it('parses simple comma and bare formats', () => {
    const items = parsePastedPartsList('LM7805CT, 5V regulator\nPRT-17259\n');
    assert.equal(items.length, 2);
    assert.equal(items[0]!.mpn, 'LM7805CT');
    assert.equal(items[0]!.description, '5V regulator');
    assert.equal(items[1]!.mpn, 'PRT-17259');
  });

  it('ignores noise lines and dedupes part numbers', () => {
    const items = parsePastedPartsList('Qty:\nPrice:\nCurrency: US dollar\nABC-123\nabc-123\n');
    assert.equal(items.length, 1);
    assert.equal(items[0]!.mpn, 'ABC-123');
  });
});
