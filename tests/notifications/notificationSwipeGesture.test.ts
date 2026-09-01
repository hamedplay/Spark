import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getNotificationSwipeDecision,
} from '../../src/features/notifications/models/notificationSwipeGesture';

test('dismisses a deliberate horizontal swipe in either direction', () => {
  const right = getNotificationSwipeDecision(80, 420, 390);
  const left = getNotificationSwipeDecision(-80, 420, 390);

  assert.equal(right.dismiss, true);
  assert.equal(right.direction, 1);
  assert.equal(left.dismiss, true);
  assert.equal(left.direction, -1);
});

test('dismisses a short fast flick on mobile', () => {
  const result = getNotificationSwipeDecision(34, 50, 390);

  assert.equal(result.dismiss, true);
  assert.equal(result.direction, 1);
  assert.ok(result.velocityPxPerMs >= 0.5);
});

test('does not dismiss a small slow drag', () => {
  const result = getNotificationSwipeDecision(30, 500, 390);

  assert.equal(result.dismiss, false);
});

test('keeps the distance threshold usable on narrow and wide phones', () => {
  const narrow = getNotificationSwipeDecision(0, 100, 320);
  const wide = getNotificationSwipeDecision(0, 100, 480);

  assert.equal(narrow.thresholdPx, 64);
  assert.equal(wide.thresholdPx, 88);
});
