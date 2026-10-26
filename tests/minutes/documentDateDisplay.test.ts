import assert from 'node:assert/strict';
import test from 'node:test';
import { faDate, faDateTime } from '../../src/components/Minutes/MinutesDocumentData';

test('document date fields always display Persian calendar dates',()=>{
  assert.equal(faDate('2026-09-27'),'۱۴۰۵/۰۷/۰۵');
  assert.equal(faDate('1405/07/05'),'۱۴۰۵/۰۷/۰۵');
  assert.equal(faDate('2026-09-26T20:30:00.000Z'),'۱۴۰۵/۰۷/۰۵');
});
test('missing or invalid document dates never display Invalid Date or raw input',()=>{
  for (const value of [null,'','invalid']) {
    assert.equal(faDate(value),'—');
    assert.equal(faDateTime(value),'—');
  }
  assert.equal(faDateTime('2026-09-27T12:30:00Z'),'۱۴۰۵/۰۷/۰۵ — ۱۶:۰۰');
});
