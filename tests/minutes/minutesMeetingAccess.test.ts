import assert from 'node:assert/strict';
import test from 'node:test';

import { interpretMinutesAccess } from '../../src/lib/minutesMeetingAccess';

test('allows creating minutes when permitted and no existing minutes', () => {
  const result = interpretMinutesAccess(true, []);
  assert.equal(result.allowed, true);
  assert.equal(result.existingMinuteId, null);
  assert.equal(result.errorCode, null);
});

test('blocks creation when permission RPC returns false', () => {
  const result = interpretMinutesAccess(false, []);
  assert.equal(result.allowed, false);
  assert.equal(result.errorCode, 'MEETING_NO_PERMISSION');
  assert.equal(result.existingMinuteId, null);
});

test('returns existing minute id when minutes already exist', () => {
  const result = interpretMinutesAccess(true, [{ id: 'minute-1', status: 'draft' }]);
  assert.equal(result.allowed, false);
  assert.equal(result.errorCode, 'MINUTES_ALREADY_EXISTS');
  assert.equal(result.existingMinuteId, 'minute-1');
  assert.equal(result.existingMinuteStatus, 'draft');
});

test('returns CHECK_FAILED when permission RPC returns null', () => {
  const result = interpretMinutesAccess(null, []);
  assert.equal(result.allowed, false);
  assert.equal(result.errorCode, 'CHECK_FAILED');
});

test('returns existing minute even if permission check fails', () => {
  const result = interpretMinutesAccess(false, [{ id: 'minute-2', status: 'published' }]);
  assert.equal(result.allowed, false);
  assert.equal(result.errorCode, 'MEETING_NO_PERMISSION');
  assert.equal(result.existingMinuteId, null);
});
