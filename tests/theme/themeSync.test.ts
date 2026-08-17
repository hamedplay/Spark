import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Theme sync contract after the Appearance phase:
 * - light/dark remains a per-user preference;
 * - accent is global and comes from system_config.appearance.primary_color;
 * - legacy prefs.accent_color never overrides or persists the visible accent.
 */

type Theme = 'light' | 'dark';

interface SyncState {
  theme: Theme;
  remoteTheme: Theme;
  globalAccent: string;
  legacyUserAccent: string;
  loading: boolean;
  hydrated: boolean;
  skipThemePersist: boolean;
  lastRemoteTheme: Theme | null;
  updateCalls: { theme?: Theme; accent_color?: string }[];
}

function createSyncState(theme: Theme, globalAccent = '#4f46e5'): SyncState {
  return {
    theme,
    remoteTheme: theme,
    globalAccent,
    legacyUserAccent: 'teal',
    loading: true,
    hydrated: false,
    skipThemePersist: false,
    lastRemoteTheme: null,
    updateCalls: [],
  };
}

function remoteThemeEffect(state: SyncState): void {
  if (state.loading) return;

  state.lastRemoteTheme = state.remoteTheme;
  if (state.theme !== state.remoteTheme) {
    state.skipThemePersist = true;
    state.theme = state.remoteTheme;
  }
  state.hydrated = true;
}

function persistThemeEffect(state: SyncState): void {
  if (state.loading || !state.hydrated) return;

  if (state.skipThemePersist) {
    state.skipThemePersist = false;
    return;
  }

  if (state.lastRemoteTheme === state.theme) return;
  state.lastRemoteTheme = state.theme;
  state.updateCalls.push({ theme: state.theme });
}

function userToggleTheme(state: SyncState): void {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
}

function applyGlobalAccent(state: SyncState, dbColor: string): void {
  state.globalAccent = dbColor;
}

test('remote user theme overrides local theme without write-back', () => {
  const state = createSyncState('light');
  state.loading = false;
  state.remoteTheme = 'dark';

  remoteThemeEffect(state);
  persistThemeEffect(state);

  assert.equal(state.theme, 'dark');
  assert.equal(state.updateCalls.length, 0);
});

test('user light/dark change persists exactly once', () => {
  const state = createSyncState('dark');
  state.loading = false;
  state.remoteTheme = 'dark';

  remoteThemeEffect(state);
  persistThemeEffect(state);
  assert.equal(state.updateCalls.length, 0);

  userToggleTheme(state);
  persistThemeEffect(state);
  persistThemeEffect(state);

  assert.equal(state.theme, 'light');
  assert.deepEqual(state.updateCalls, [{ theme: 'light' }]);
});

test('global appearance primary_color is the visible accent source', () => {
  const state = createSyncState('light', '#4f46e5');
  state.legacyUserAccent = 'rose';

  applyGlobalAccent(state, '#0891b2');

  assert.equal(state.globalAccent, '#0891b2');
  assert.equal(state.legacyUserAccent, 'rose');
  assert.equal(state.updateCalls.length, 0,
    'applying the global accent must never write a per-user accent preference');
});

test('legacy per-user accent does not override global accent', () => {
  const state = createSyncState('dark', '#7c3aed');
  state.loading = false;
  state.remoteTheme = 'dark';
  state.legacyUserAccent = 'amber';

  remoteThemeEffect(state);

  assert.equal(state.globalAccent, '#7c3aed');
  assert.equal(state.legacyUserAccent, 'amber');
  assert.equal(state.updateCalls.some(call => 'accent_color' in call), false);
});

test('global accent can change independently of the user theme', () => {
  const state = createSyncState('dark', '#4f46e5');
  state.loading = false;
  state.remoteTheme = 'dark';
  remoteThemeEffect(state);

  applyGlobalAccent(state, '#059669');
  persistThemeEffect(state);

  assert.equal(state.theme, 'dark');
  assert.equal(state.globalAccent, '#059669');
  assert.equal(state.updateCalls.length, 0);
});

test('external user theme change applies without write-back', () => {
  const state = createSyncState('dark');
  state.loading = false;
  state.remoteTheme = 'dark';
  remoteThemeEffect(state);

  state.remoteTheme = 'light';
  remoteThemeEffect(state);
  persistThemeEffect(state);

  assert.equal(state.theme, 'light');
  assert.equal(state.updateCalls.length, 0);
});

test('no user-preference sync or write occurs while loading', () => {
  const state = createSyncState('light');
  state.remoteTheme = 'dark';

  remoteThemeEffect(state);
  userToggleTheme(state);
  persistThemeEffect(state);

  assert.equal(state.theme, 'dark');
  assert.equal(state.hydrated, false);
  assert.equal(state.updateCalls.length, 0);
});

test('preference response matching local theme produces no duplicate update', () => {
  const state = createSyncState('dark');
  state.loading = false;
  state.remoteTheme = 'dark';
  remoteThemeEffect(state);

  userToggleTheme(state);
  persistThemeEffect(state);
  assert.deepEqual(state.updateCalls, [{ theme: 'light' }]);

  state.remoteTheme = 'light';
  remoteThemeEffect(state);
  persistThemeEffect(state);

  assert.equal(state.theme, 'light');
  assert.equal(state.updateCalls.length, 1);
});
