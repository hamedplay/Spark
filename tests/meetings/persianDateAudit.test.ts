import assert from 'node:assert/strict';
import test from 'node:test';
import { profileDateForExport, profileDateFromImport } from '../../src/components/UserManagement/profileDateTransfer';
import { meetingStartInstant } from '../../src/features/meetings/meetingStartInstant';

for (const day of ['2026-09-27','2024-03-20','2025-03-20']) {
  test(`profile spreadsheet dates round trip ${day} through Persian display`,()=>{
    const display=profileDateForExport(day);
    assert.match(display,/^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/);
    assert.equal(profileDateFromImport(display),day);
    assert.equal(profileDateFromImport(day),day);
  });
}
test('empty profile dates remain empty and invalid import dates are rejected',()=>{
  assert.equal(profileDateForExport(null),'');
  assert.equal(profileDateFromImport(''),null);
  assert.throws(()=>profileDateFromImport('1405/13/05'));
  assert.throws(()=>profileDateFromImport('not a date'));
});
test('online access uses the Tehran meeting day rather than the previous UTC day',()=>{
  assert.equal(meetingStartInstant({request_date:'2026-09-26T20:30:00.000Z',start_time:'16:00'})?.toISOString(),'2026-09-27T12:30:00.000Z');
});
test('online access supports a stored Jalali day and never invents missing dates',()=>{
  assert.equal(meetingStartInstant({request_jalaali_date:'۱۴۰۵/۰۷/۰۵',start_time:'16:00'})?.toISOString(),'2026-09-27T12:30:00.000Z');
  assert.equal(meetingStartInstant({request_date:null,start_time:'16:00'}),null);
  assert.equal(meetingStartInstant({request_date:'invalid',start_time:'16:00'}),null);
});

test('meeting start instant stays identical across device timezones',()=>{
  const original = process.env.TZ;
  try {
    for (const timezone of ['UTC','Asia/Tehran','America/Los_Angeles']) {
      process.env.TZ=timezone;
      assert.equal(meetingStartInstant({request_date:'2026-09-26T20:30:00.000Z',start_time:'16:00'})?.toISOString(),'2026-09-27T12:30:00.000Z');
    }
  } finally { if(original===undefined) delete process.env.TZ; else process.env.TZ=original; }
});
