import assert from 'node:assert/strict';
import test from 'node:test';

import {
  startUserPreferencesLifecycle,
} from '../../src/features/user-preferences/services/userPreferencesLifecycle';
import type {
  StartUserPreferencesLifecycleInput,
} from '../../src/features/user-preferences/services/userPreferencesLifecycle';
import type {
  UserPreferences,
} from '../../src/features/user-preferences/types/userPreferences';
import {
  DEFAULT_USER_PREFERENCES,
} from '../../src/features/user-preferences/types/userPreferences';

type AuthListener = (
  userId: string | null
) => void;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface MutableCounter {
  value: number;
}

interface LifecycleHarness {
  authListener: AuthListener | null;
  unsubscribe: () => void;
  userDeferred: Deferred<string | null>;
  loadDeferreds: Deferred<UserPreferences | null>[];
  loadCounter: MutableCounter;
  userIdChanges: (string | null)[];
  loadedPrefs: UserPreferences[];
  signedOutCalls: MutableCounter;
  loadingCompleteCalls: MutableCounter;
}

function createHarness(): LifecycleHarness {
  let authListener: AuthListener | null =
    null;
  const userDeferred =
    createDeferred<string | null>();
  const loadDeferreds: Deferred<
    UserPreferences | null
  >[] = [];
  const loadCounter: MutableCounter = {
    value: 0,
  };
  const userIdChanges: (string | null)[] =
    [];
  const loadedPrefs: UserPreferences[] = [];
  const signedOutCalls: MutableCounter = {
    value: 0,
  };
  const loadingCompleteCalls: MutableCounter =
    { value: 0 };

  const input: StartUserPreferencesLifecycleInput =
    {
      getCurrentUserId: () =>
        userDeferred.promise,
      subscribeToAuthUserIdChanges:
        (listener) => {
          authListener = listener;
          return () => {};
        },
      loadPreferences: () => {
        const d = createDeferred<
          UserPreferences | null
        >();
        loadDeferreds.push(d);
        loadCounter.value++;
        return d.promise;
      },
      onUserIdChange: (id) =>
        userIdChanges.push(id),
      onPreferencesLoaded: (p) =>
        loadedPrefs.push(p),
      onSignedOut: () =>
        signedOutCalls.value++,
      onLoadingComplete: () =>
        loadingCompleteCalls.value++,
    };

  const unsubscribe =
    startUserPreferencesLifecycle(input);

  return {
    authListener,
    unsubscribe,
    userDeferred,
    loadDeferreds,
    loadCounter,
    userIdChanges,
    loadedPrefs,
    signedOutCalls,
    loadingCompleteCalls,
  };
}

function flush(): Promise<void> {
  return new Promise((r) =>
    setImmediate(r)
  );
}

test('loads preferences for the initial authenticated user', async () => {
  const h = createHarness();

  h.userDeferred.resolve('user-1');
  await flush();

  assert.equal(h.loadCounter.value, 1);
  assert.deepEqual(h.userIdChanges, [
    'user-1',
  ]);

  const loaded: UserPreferences = {
    ...DEFAULT_USER_PREFERENCES,
    theme: 'dark',
    accent_color: 'blue',
  };
  h.loadDeferreds[0].resolve(loaded);
  await flush();

  assert.equal(h.loadedPrefs.length, 1);
  assert.equal(
    h.loadedPrefs[0].theme,
    'dark'
  );
  assert.equal(
    h.loadedPrefs[0].accent_color,
    'blue'
  );
  assert.equal(
    h.loadingCompleteCalls.value,
    1
  );

  h.unsubscribe();
});

test('finishes loading when there is no initial user', async () => {
  const h = createHarness();

  h.userDeferred.resolve(null);
  await flush();

  assert.equal(
    h.loadingCompleteCalls.value,
    1
  );
  assert.equal(h.loadedPrefs.length, 0);
  assert.equal(h.userIdChanges.length, 0);
  assert.equal(h.loadCounter.value, 0);

  h.unsubscribe();
});

test('resets through the signed-out callback on Auth sign-out', async () => {
  const h = createHarness();

  assert.ok(h.authListener);
  h.authListener!(null);

  assert.equal(h.signedOutCalls.value, 1);
  assert.deepEqual(h.userIdChanges, [
    null,
  ]);
  assert.equal(
    h.loadingCompleteCalls.value,
    1
  );

  h.unsubscribe();
});

test('loads preferences for a later Auth user', async () => {
  const h = createHarness();

  assert.ok(h.authListener);
  h.authListener!('user-2');
  await flush();

  assert.equal(h.loadCounter.value, 1);
  assert.deepEqual(h.userIdChanges, [
    'user-2',
  ]);

  const loaded: UserPreferences = {
    ...DEFAULT_USER_PREFERENCES,
    theme: 'dark',
  };
  h.loadDeferreds[0].resolve(loaded);
  await flush();

  assert.equal(h.loadedPrefs.length, 1);
  assert.equal(
    h.loadedPrefs[0].theme,
    'dark'
  );
  assert.equal(
    h.loadingCompleteCalls.value,
    1
  );

  h.unsubscribe();
});

test('ignores stale loads after the Auth user changes', async () => {
  const h = createHarness();

  h.userDeferred.resolve('user-1');
  await flush();

  assert.equal(h.loadCounter.value, 1);

  assert.ok(h.authListener);
  h.authListener!('user-2');
  await flush();

  assert.equal(h.loadCounter.value, 2);

  h.loadDeferreds[0].resolve({
    ...DEFAULT_USER_PREFERENCES,
    theme: 'dark',
  });
  h.loadDeferreds[1].resolve({
    ...DEFAULT_USER_PREFERENCES,
    theme: 'light',
    accent_color: 'rose',
  });
  await flush();

  assert.equal(h.loadedPrefs.length, 1);
  assert.equal(
    h.loadedPrefs[0].theme,
    'light'
  );
  assert.equal(
    h.loadedPrefs[0].accent_color,
    'rose'
  );

  h.unsubscribe();
});

test('unsubscribes and ignores late async work after cleanup', async () => {
  const h = createHarness();

  h.unsubscribe();

  h.userDeferred.resolve('user-1');
  await flush();

  if (h.loadDeferreds.length > 0) {
    h.loadDeferreds[0].resolve({
      ...DEFAULT_USER_PREFERENCES,
      theme: 'dark',
    });
  }
  await flush();

  assert.equal(h.loadedPrefs.length, 0);
  assert.equal(
    h.loadingCompleteCalls.value,
    0
  );
});
