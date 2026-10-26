import assert from 'node:assert/strict';
import test from 'node:test';
import { formatMeetingNotificationDate } from '../../src/features/meetings/formatMeetingNotificationDate';

test('stored Jalali date is available when Gregorian timestamp is missing',()=>{
  assert.equal(formatMeetingNotificationDate({request_date:null,request_jalaali_date:'۱۴۰۵/۰۷/۰۵'}),'1405/07/05');
});
test('timestamp uses Tehran day across UTC midnight',()=>{
  assert.equal(formatMeetingNotificationDate({request_date:'2026-09-26T20:30:00.000Z'}),'1405/07/05');
});
test('missing or invalid dates never become today or the Unix epoch',()=>{
  assert.equal(formatMeetingNotificationDate({request_date:null,request_jalaali_date:null}),'');
  assert.equal(formatMeetingNotificationDate({request_date:'invalid'}),'');
});
