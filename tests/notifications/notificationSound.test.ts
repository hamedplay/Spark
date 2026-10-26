import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlockNotificationSound, playNotificationSound } from '../../src/lib/notificationSound';

test('notification audio unlocks on interaction, reuses one context and plays a short two-tone chime', () => {
  let created = 0, resumed = 0;
  const frequencies: number[] = [], stops: number[] = [];
  class Context {
    state = 'suspended'; currentTime = 10; destination = {};
    constructor() { created++; }
    async resume() { resumed++; this.state = 'running'; }
    createOscillator() { const frequency = { value: 0 }; return { frequency, type: '', connect() {}, start() { frequencies.push(frequency.value); }, stop(time: number) { stops.push(time); } }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }
  Object.defineProperty(globalThis, 'window', { value: { AudioContext: Context }, configurable: true });
  playNotificationSound(); assert.equal(frequencies.length, 0);
  unlockNotificationSound(); playNotificationSound(); unlockNotificationSound();
  assert.equal(created, 1); assert.equal(resumed, 1);
  assert.deepEqual(frequencies, [660,880]); assert.ok(stops.every(time => time <= 10.4));
});
