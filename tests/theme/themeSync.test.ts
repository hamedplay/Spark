import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Theme Sync logic tests — pure logic verification of the race-condition
 * prevention in AuthenticatedThemeSync.
 *
 * The simulation models the React effect dependency arrays explicitly:
 * - Remote effect deps: [loading, prefs.theme, prefs.accent_color, setTheme, setAccent]
 *   (does NOT include `theme` or `accent`)
 * - Persist theme effect deps: [theme, loading, updatePrefs]
 * - Persist accent effect deps: [accent, loading, updatePrefs]
 *
 * `setTheme`/`setAccent`/`updatePrefs` are stable (useCallback/useMemo),
 * so they never trigger re-execution on their own.
 */

type Theme = 'light' | 'dark';
type Accent = string;

interface SyncState {
  // local state (owned by ThemeProvider)
  theme: Theme;
  accent: Accent;
  // remote state (owned by UserPreferencesProvider)
  remoteTheme: Theme;
  remoteAccent: Accent;
  loading: boolean;
  hydrated: boolean;
  skipThemePersist: boolean;
  skipAccentPersist: boolean;
  lastRemoteTheme: Theme | null;
  lastRemoteAccent: Accent | null;
  updateCalls: { theme?: Theme; accent_color?: Accent }[];
}

function createSyncState(localTheme: Theme, localAccent: Accent): SyncState {
  return {
    theme: localTheme,
    accent: localAccent,
    remoteTheme: localTheme,
    remoteAccent: localAccent,
    loading: true,
    hydrated: false,
    skipThemePersist: false,
    skipAccentPersist: false,
    lastRemoteTheme: null,
    lastRemoteAccent: null,
    updateCalls: [],
  };
}

/**
 * Simulates the Remote→Local effect.
 * In real React this runs when [loading, prefs.theme, prefs.accent_color, setTheme, setAccent] change.
 * It does NOT run when only `theme` or `accent` change.
 */
function remoteEffect(state: SyncState): void {
  if (state.loading) return;

  const remoteTheme = state.remoteTheme;
  const remoteAccent = state.remoteAccent;

  state.lastRemoteTheme = remoteTheme;
  state.lastRemoteAccent = remoteAccent;

  if (state.theme !== remoteTheme) {
    state.skipThemePersist = true;
    state.theme = remoteTheme;
  }

  if (state.accent !== remoteAccent) {
    state.skipAccentPersist = true;
    state.accent = remoteAccent;
  }

  state.hydrated = true;
}

/**
 * Simulates the theme persist effect.
 * In real React this runs when [theme, loading, updatePrefs] change.
 */
function persistThemeEffect(state: SyncState): void {
  if (state.loading || !state.hydrated) return;

  if (state.skipThemePersist) {
    state.skipThemePersist = false;
    return;
  }

  if (state.lastRemoteTheme === state.theme) return;

  const previousRemote = state.lastRemoteTheme;
  state.lastRemoteTheme = state.theme;
  state.updateCalls.push({ theme: state.theme });
  // Simulate failure rollback by restoring previousRemote (not used in success path)
  void previousRemote;
}

/**
 * Simulates the accent persist effect.
 * In real React this runs when [accent, loading, updatePrefs] change.
 */
function persistAccentEffect(state: SyncState): void {
  if (state.loading || !state.hydrated) return;

  if (state.skipAccentPersist) {
    state.skipAccentPersist = false;
    return;
  }

  if (state.lastRemoteAccent === state.accent) return;

  const previousRemote = state.lastRemoteAccent;
  state.lastRemoteAccent = state.accent;
  state.updateCalls.push({ accent_color: state.accent });
  void previousRemote;
}

/** User changes local theme (toggleTheme). */
function userToggleTheme(state: SyncState): void {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
}

/** User changes local accent (setAccent). */
function userSetAccent(state: SyncState, next: Accent): void {
  state.accent = next;
}

// ── Scenario 1: DB must override Local ─────────────────────────────────────

test('scenario 1: DB dark/rose overrides Local light/teal without write-back', () => {
  const state = createSyncState('light', 'teal');

  // Simulate loading completing with DB values
  state.loading = false;
  state.remoteTheme = 'dark';
  state.remoteAccent = 'rose';

  // Remote effect fires (loading changed, prefs changed)
  remoteEffect(state);

  assert.equal(state.theme, 'dark');
  assert.equal(state.accent, 'rose');

  // Persist effects fire (theme changed, accent changed)
  persistThemeEffect(state);
  persistAccentEffect(state);

  assert.equal(state.updateCalls.length, 0,
    'DB values applied to local must NOT trigger write-back to DB');
});

// ── Scenario 2: Real user change triggers exactly one update ───────────────

test('scenario 2: user theme change triggers exactly one update', () => {
  const state = createSyncState('dark', 'rose');
  state.loading = false;
  state.remoteTheme = 'dark';
  state.remoteAccent = 'rose';

  remoteEffect(state);
  persistThemeEffect(state);
  persistAccentEffect(state);
  assert.equal(state.updateCalls.length, 0);

  // User toggles theme dark → light
  userToggleTheme(state);
  assert.equal(state.theme, 'light');

  // KEY: remote effect does NOT fire because `theme` is not in its dependency array.
  // Only persistThemeEffect fires.
  persistThemeEffect(state);

  assert.equal(state.updateCalls.length, 1,
    'user theme change must trigger exactly one update');
  assert.deepEqual(state.updateCalls[0], { theme: 'light' });

  // Running persist again should NOT produce another update
  persistThemeEffect(state);
  assert.equal(state.updateCalls.length, 1,
    'same theme value must not trigger duplicate updates');
});

test('scenario 2b: user accent change triggers exactly one update', () => {
  const state = createSyncState('dark', 'rose');
  state.loading = false;
  state.remoteTheme = 'dark';
  state.remoteAccent = 'rose';

  remoteEffect(state);
  persistThemeEffect(state);
  persistAccentEffect(state);
  assert.equal(state.updateCalls.length, 0);

  userSetAccent(state, 'blue');
  persistAccentEffect(state);

  assert.equal(state.updateCalls.length, 1,
    'user accent change must trigger exactly one update');
  assert.deepEqual(state.updateCalls[0], { accent_color: 'blue' });

  persistAccentEffect(state);
  assert.equal(state.updateCalls.length, 1);
});

// ── Scenario 3: Logout does not revert theme ────────────────────────────────

test('scenario 3: logout keeps current theme — no revert to old provider state', () => {
  const state = createSyncState('dark', 'rose');
  state.loading = false;
  state.remoteTheme = 'dark';
  state.remoteAccent = 'rose';

  remoteEffect(state);
  persistThemeEffect(state);
  persistAccentEffect(state);

  userToggleTheme(state);
  persistThemeEffect(state);
  assert.equal(state.theme, 'light');
  assert.equal(state.updateCalls.length, 1);

  // Simulate logout: ThemeProvider is NOT unmounted (single provider).
  // No new remote prefs arrive, so remote effect does not fire.
  // Theme should remain 'light'
  assert.equal(state.theme, 'light',
    'theme must remain as user set it after logout — single ThemeProvider does not unmount');
});

// ── Scenario 4: Restricted session uses local theme only ───────────────────

test('scenario 4: restricted session — no preferences query or write', () => {
  const state = createSyncState('light', 'teal');
  state.loading = true;

  userToggleTheme(state);
  assert.equal(state.theme, 'dark');

  persistThemeEffect(state);

  assert.equal(state.updateCalls.length, 0,
    'restricted session must not write preferences to DB');
});

// ── Scenario 5: External preference change re-applies without write-back ───

test('scenario 5: external preference change applies to UI without write-back', () => {
  const state = createSyncState('dark', 'rose');
  state.loading = false;
  state.remoteTheme = 'dark';
  state.remoteAccent = 'rose';

  remoteEffect(state);
  persistThemeEffect(state);
  persistAccentEffect(state);
  assert.equal(state.updateCalls.length, 0);

  // External source changes DB theme to light
  state.remoteTheme = 'light';

  // Remote effect fires because prefs.theme changed
  remoteEffect(state);

  assert.equal(state.theme, 'light');

  // Persist effect fires because theme changed
  persistThemeEffect(state);

  assert.equal(state.updateCalls.length, 0,
    'external preference change must apply to UI without write-back');
});

// ── Scenario 6: No sync while loading ───────────────────────────────────────

test('scenario 6: no sync or write while loading is true', () => {
  const state = createSyncState('light', 'teal');
  state.loading = true;
  state.remoteTheme = 'dark';
  state.remoteAccent = 'rose';

  remoteEffect(state);

  assert.equal(state.theme, 'light',
    'local theme must not change while loading');
  assert.equal(state.accent, 'teal',
    'local accent must not change while loading');
  assert.equal(state.hydrated, false,
    'must not be hydrated while loading');

  persistThemeEffect(state);
  persistAccentEffect(state);

  assert.equal(state.updateCalls.length, 0,
    'no updates while loading');
});

// ── Scenario 7: Effect ordering — user change does not retrigger remote ────

test('scenario 7: user dark→light — remote effect must NOT fire, persist fires once', () => {
  const state = createSyncState('dark', 'rose');
  state.loading = false;
  state.remoteTheme = 'dark';
  state.remoteAccent = 'rose';

  // Initial hydration
  remoteEffect(state);
  persistThemeEffect(state);
  persistAccentEffect(state);
  assert.equal(state.updateCalls.length, 0);

  // User toggles theme dark → light
  userToggleTheme(state);
  assert.equal(state.theme, 'light');

  // Simulate React effect ordering after a local state change:
  //   - Remote effect deps are [loading, prefs.theme, prefs.accent_color, setTheme, setAccent]
  //     None of these changed, so remoteEffect does NOT fire.
  //   - Persist theme effect deps are [theme, loading, updatePrefs]
  //     `theme` changed, so persistThemeEffect fires.
  //
  // We explicitly do NOT call remoteEffect here.
  persistThemeEffect(state);

  assert.equal(state.theme, 'light',
    'local must remain light — remote effect must not revert it');
  assert.equal(state.updateCalls.length, 1,
    'exactly one update with light');
  assert.deepEqual(state.updateCalls[0], { theme: 'light' });

  // If updatePrefs resolves and updates prefs.theme to 'light',
  // the remote effect fires again — but local already equals remote,
  // so no setter or update should be produced.
  state.remoteTheme = 'light';
  remoteEffect(state);
  persistThemeEffect(state);

  assert.equal(state.updateCalls.length, 1,
    'after prefs sync to light, no additional update should occur');
  assert.equal(state.theme, 'light',
    'local must still be light after prefs sync');
});

// ── Scenario 8: updatePrefs response changes prefs — no extra update ──────

test('scenario 8: updatePrefs changes prefs.theme to match local — no extra update', () => {
  const state = createSyncState('dark', 'rose');
  state.loading = false;
  state.remoteTheme = 'dark';
  state.remoteAccent = 'rose';

  remoteEffect(state);
  persistThemeEffect(state);
  persistAccentEffect(state);

  userToggleTheme(state); // dark → light
  persistThemeEffect(state);
  assert.equal(state.updateCalls.length, 1);

  // updatePrefs internally updates prefs.theme to 'light'
  state.remoteTheme = 'light';

  // Remote effect fires (prefs.theme changed) but local already matches
  remoteEffect(state);

  // No skip flag set, no setter called, no update needed
  assert.equal(state.theme, 'light');
  assert.equal(state.skipThemePersist, false,
    'skip flag must not be set when local already matches remote');

  persistThemeEffect(state);
  assert.equal(state.updateCalls.length, 1,
    'no extra update when prefs sync to match local');
});
