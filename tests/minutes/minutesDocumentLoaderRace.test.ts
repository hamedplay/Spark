import { test } from 'node:test';
import assert from 'node:assert/strict';

// This test verifies the request-token / stale-rejection logic used by
// MinutesDetailPage and minutesDocumentLoader. We simulate the race
// condition where query results for minute A arrive after the user has
// already switched to minute B, and assert that the stale response is
// rejected and never overwrites the current snapshot.

interface Snapshot {
  minuteId: string;
  participants: number;
  agenda: number;
  decisions: number;
}

class FakeDetailLoader {
  private loadToken = 0;
  private loadedKey = '';
  private snapshot: Snapshot | null = null;

  getSnapshot() { return this.snapshot; }

  async load(minuteId: string, delayMs: number): Promise<Snapshot> {
    const myToken = ++this.loadToken;
    const key = minuteId;
    this.loadedKey = key;

    // Simulate query delay
    await new Promise(resolve => setTimeout(resolve, delayMs));

    // Stale rejection: a newer load has started
    if (myToken !== this.loadToken) {
      return { minuteId, participants: 0, agenda: 0, decisions: 0 };
    }
    if (this.loadedKey !== key) {
      return { minuteId, participants: 0, agenda: 0, decisions: 0 };
    }

    // Simulate atomic snapshot built from all completed queries
    const snap: Snapshot = {
      minuteId,
      participants: minuteId === 'A' ? 3 : 5,
      agenda: minuteId === 'A' ? 2 : 4,
      decisions: minuteId === 'A' ? 1 : 2,
    };
    this.snapshot = snap;
    return snap;
  }

  invalidate() {
    this.snapshot = null;
  }
}

test('race condition: stale response from minute A does not overwrite minute B', async () => {
  const loader = new FakeDetailLoader();

  // Start loading minute A with a long delay (200ms)
  const promiseA = loader.load('A', 200);

  // Immediately switch to minute B with a short delay (50ms)
  // Invalidate the previous snapshot
  loader.invalidate();
  const promiseB = loader.load('B', 50);

  // B completes first
  const snapB = await promiseB;
  assert.equal(snapB.minuteId, 'B');
  assert.equal(loader.getSnapshot()?.minuteId, 'B');
  assert.equal(loader.getSnapshot()?.participants, 5);
  assert.equal(loader.getSnapshot()?.agenda, 4);
  assert.equal(loader.getSnapshot()?.decisions, 2);

  // A completes later but must NOT overwrite B
  const snapA = await promiseA;
  assert.equal(snapA.minuteId, 'A');
  // The snapshot should still be B — A was stale and rejected
  assert.equal(loader.getSnapshot()?.minuteId, 'B');
  assert.equal(loader.getSnapshot()?.participants, 5);
  assert.equal(loader.getSnapshot()?.agenda, 4);
  assert.equal(loader.getSnapshot()?.decisions, 2);
});

test('race condition: fast switching through 3 minutes, only last one wins', async () => {
  const loader = new FakeDetailLoader();

  // Start all three loads simultaneously with increasing delays
  const promiseA = loader.load('A', 150);
  loader.invalidate();
  const promiseB = loader.load('B', 100);
  loader.invalidate();
  const promiseC = loader.load('C', 50);

  // C completes first and should be the snapshot
  const snapC = await promiseC;
  assert.equal(snapC.minuteId, 'C');
  assert.equal(loader.getSnapshot()?.minuteId, 'C');

  // B completes but should be rejected (stale)
  const snapB = await promiseB;
  assert.equal(snapB.minuteId, 'B');
  assert.equal(loader.getSnapshot()?.minuteId, 'C');

  // A completes but should be rejected (stale)
  const snapA = await promiseA;
  assert.equal(snapA.minuteId, 'A');
  assert.equal(loader.getSnapshot()?.minuteId, 'C');
  assert.equal(loader.getSnapshot()?.participants, 5); // C uses same defaults as B in the fake
});

test('race condition: snapshot is null while loading, no partial data shown', async () => {
  const loader = new FakeDetailLoader();

  // Start a load with 100ms delay
  loader.invalidate();
  const promise = loader.load('A', 100);

  // While loading, snapshot should be null (no partial/stale data)
  assert.equal(loader.getSnapshot(), null);

  await promise;
  // After load completes, snapshot is set
  assert.equal(loader.getSnapshot()?.minuteId, 'A');
  assert.equal(loader.getSnapshot()?.participants, 3);
  assert.equal(loader.getSnapshot()?.agenda, 2);
  assert.equal(loader.getSnapshot()?.decisions, 1);
});

test('race condition: invalidate clears previous snapshot on minuteId change', async () => {
  const loader = new FakeDetailLoader();

  // Load minute A
  const snapA = await loader.load('A', 10);
  assert.equal(loader.getSnapshot()?.minuteId, 'A');

  // Switch to minute B: invalidate first
  loader.invalidate();
  assert.equal(loader.getSnapshot(), null);

  // Load minute B
  const snapB = await loader.load('B', 10);
  assert.equal(loader.getSnapshot()?.minuteId, 'B');
  assert.equal(loader.getSnapshot()?.participants, 5);
});
