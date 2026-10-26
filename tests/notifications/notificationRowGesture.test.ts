import assert from 'node:assert/strict';
import { test } from 'node:test';
import { notificationRowGesture, notificationRowAction } from '../../src/features/notifications/models/notificationRowGesture';

test('physical left deletes and physical right marks read regardless of RTL', () => {
  assert.equal(notificationRowAction(-72, false), 'delete');
  assert.equal(notificationRowAction(72, false), 'read');
  assert.equal(notificationRowAction(-110, true), 'delete');
  assert.equal(notificationRowAction(110, true), null);
});
test('small movements cannot execute destructive or read actions', () => {
  for (const dx of [-71, -20, 0, 20, 71]) assert.equal(notificationRowAction(dx, false), null);
});
test('axis locking preserves vertical scrolling and ignores tap jitter', () => {
  assert.equal(notificationRowGesture(5, 4), 'pending');
  assert.equal(notificationRowGesture(80, 5), 'horizontal');
  assert.equal(notificationRowGesture(-80, 5), 'horizontal');
  assert.equal(notificationRowGesture(20, 80), 'vertical');
  assert.equal(notificationRowGesture(40, 40), 'vertical');
});
