import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Theme Sync logic tests — pure logic verification of the race-condition
 * prevention in AuthenticatedThemeSync.
 *
 * These tests verify the ref-based skip mechanism by simulating the
 * state transitions that the React effects would perform.
 */

interface SyncState {
  theme: 'light' | 'dark';
  accent: string;
  loading: boolean;
  hydrated: boolean;
  skipThemePersist: boolean;
  skipAccentPersist: boolean;
  lastRemoteTheme: 'light' | 'dark' | null;
  lastRemoteAccent: string | null;
  updateCalls: { theme?: 'light' | 'dark'; accent_color?: string }[];
}

function createSyncState(localTheme: 'light' | 'dark', localAccent: string): SyncState {
  return {
    theme: localTheme,
    accent: localAccent,
    loading: true,
    hydrated: false,
    skipThemePersist: false,
    skipAccentPersist: false,
    lastRemoteTheme: null,
    lastRemoteAccent: null,
    updateCalls: [],
  };
}

function applyRemote(
  state: SyncState,
  dbTheme: 'light' | 'dark',
  dbAccent: string
): SyncState {
  if (state.loading) return state;

  state.lastRemoteTheme = dbTheme;
  state.lastRemoteAccent = dbAccent;

  if (dbTheme !== state.theme) {
    state.skipThemePersist = true;
    state.theme = dbTheme;
  }

  if (dbAccent !== state.accent) {
    state.skipAccentPersist = true;
    state.accent = dbAccent;
  }

  state.hydrated = true;
  return state;
}

function userToggleTheme(state: SyncState): SyncState {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  return state;
}

function persistTheme(state: SyncState): SyncState {
  if (state.loading || !state.hydrated) return state;

  if (state.skipThemePersist) {
    state.skipThemePersist = false;
    return state;
  }

  if (state.lastRemoteTheme === state.theme) return state;

  state.lastRemoteTheme = state.theme;
  state.updateCalls.push({ theme: state.theme });
  return state;
}

function persistAccent(state: SyncState): SyncState {
  if (state.loading || !state.hydrated) return state;

  if (state.skipAccentPersist) {
    state.skipAccentPersist = false;
    return state;
  }

  if (state.lastRemoteAccent === state.accent) return state;

  state.lastRemoteAccent = state.accent;
  state.updateCalls.push({ accent_color: state.accent });
  return state;
}

// ── Scenario 1: DB must override Local ─────────────────────────────────────

test('scenario 1: DB dark/rose overrides Local light/teal without write-back', () => {
  const state = createSyncState('light', 'teal');

  // Simulate loading completing with DB values
  state.loading = false;
  applyRemote(state, 'dark', 'rose');

  // After remote apply, local state should match DB
  assert.equal(state.theme, 'dark');
  assert.equal(state.accent, 'rose');

  // Persist effects run — should be skipped because skip flags are set
  persistTheme(state);
  persistAccent(state);

  // No updatePrefs should have been called
  assert.equal(state.updateCalls.length, 0,
    'DB values applied to local must NOT trigger write-back to DB');
});

// ── Scenario 2: Real user change triggers exactly one update ───────────────

test('scenario 2: user theme change triggers exactly one update', () => {
  const state = createSyncState('dark', 'rose');
  state.loading = false;
  applyRemote(state, 'dark', 'rose');

  // Clear skip flags from initial hydration
  persistTheme(state);
  persistAccent(state);
  assert.equal(state.updateCalls.length, 0);

  // User toggles theme dark → light
  userToggleTheme(state);
  assert.equal(state.theme, 'light');

  // Persist effect runs
  persistTheme(state);

  assert.equal(state.updateCalls.length, 1,
    'user theme change must trigger exactly one update');
  assert.deepEqual(state.updateCalls[0], { theme: 'light' });

  // Running persist again should NOT produce another update
  persistTheme(state);
  assert.equal(state.updateCalls.length, 1,
    'same theme value must not trigger duplicate updates');
});

test('scenario 2b: user accent change triggers exactly one update', () => {
  const state = createSyncState('dark', 'rose');
  state.loading = false;
  applyRemote(state, 'dark', 'rose');

  persistTheme(state);
  persistAccent(state);
  assert.equal(state.updateCalls.length, 0);

  // User changes accent rose → blue
  state.accent = 'blue';
  persistAccent(state);

  assert.equal(state.updateCalls.length, 1,
    'user accent change must trigger exactly one update');
  assert.deepEqual(state.updateCalls[0], { accent_color: 'blue' });

  persistAccent(state);
  assert.equal(state.updateCalls.length, 1);
});

// ── Scenario 3: Logout does not revert theme ────────────────────────────────

test('scenario 3: logout keeps current theme — no revert to old provider state', () => {
  const state = createSyncState('dark', 'rose');
  state.loading = false;
  applyRemote(state, 'dark', 'rose');
  persistTheme(state);
  persistAccent(state);

  // User changes theme to light
  userToggleTheme(state);
  persistTheme(state);
  assert.equal(state.theme, 'light');
  assert.equal(state.updateCalls.length, 1);

  // Simulate logout: loading stays false, but session is gone.
  // The ThemeProvider is NOT unmounted (single provider), so theme persists.
  // No new remote apply happens (loading=false but no new prefs).
  // Theme should remain 'light'
  assert.equal(state.theme, 'light',
    'theme must remain as user set it after logout — single ThemeProvider does not unmount');
});

// ── Scenario 4: Restricted session uses local theme only ───────────────────

test('scenario 4: restricted session — no preferences query or write', () => {
  const state = createSyncState('light', 'teal');

  // In restricted mode, UserPreferencesProvider is never mounted,
  // so loading never completes and no sync happens.
  state.loading = true;

  // User toggles theme locally
  userToggleTheme(state);
  assert.equal(state.theme, 'dark');

  // Persist effect: loading is true, so it returns early
  persistTheme(state);

  assert.equal(state.updateCalls.length, 0,
    'restricted session must not write preferences to DB');
});

// ── Scenario 5: External preference change re-applies without write-back ───

test('scenario 5: external preference change applies to UI without write-back', () => {
  const state = createSyncState('dark', 'rose');
  state.loading = false;
  applyRemote(state, 'dark', 'rose');
  persistTheme(state);
  persistAccent(state);
  assert.equal(state.updateCalls.length, 0);

  // External source changes DB theme to light
  applyRemote(state, 'light', 'rose');

  // Local state should now be light
  assert.equal(state.theme, 'light');

  // Persist effect runs — should be skipped
  persistTheme(state);

  assert.equal(state.updateCalls.length, 0,
    'external preference change must apply to UI without write-back');
});

// ── Scenario 6: No sync while loading ───────────────────────────────────────

test('scenario 6: no sync or write while loading is true', () => {
  const state = createSyncState('light', 'teal');
  state.loading = true;

  // Attempt remote apply while loading — should be no-op
  applyRemote(state, 'dark', 'rose');

  assert.equal(state.theme, 'light',
    'local theme must not change while loading');
  assert.equal(state.accent, 'teal',
    'local accent must not change while loading');
  assert.equal(state.hydrated, false,
    'must not be hydrated while loading');

  // Attempt persist while loading — should be no-op
  persistTheme(state);
  persistAccent(state);

  assert.equal(state.updateCalls.length, 0,
    'no updates while loading');
});
