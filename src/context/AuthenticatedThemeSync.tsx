import { useEffect, useRef } from 'react';
import { useTheme, ACCENT_COLORS, type AccentKey, type Theme } from './ThemeContext';
import { useUserPreferences } from '../features/user-preferences';

/**
 * Bridge that syncs theme/accent from user preferences into the pure ThemeProvider.
 * Must be rendered INSIDE both a ThemeProvider and a UserPreferencesProvider.
 * Does NOT create its own ThemeProvider — the single ThemeProvider in AuthenticatedApp owns the DOM.
 */
export function AuthenticatedThemeSync() {
  const { prefs, loading, updatePrefs } = useUserPreferences();
  const { theme, setTheme, accent, setAccent } = useTheme();

  const skipThemePersistRef = useRef(false);
  const skipAccentPersistRef = useRef(false);
  const hydratedRef = useRef(false);
  const lastRemoteThemeRef = useRef<Theme | null>(null);
  const lastRemoteAccentRef = useRef<AccentKey | null>(null);

  // Refs mirror current local state so the remote effect can read it
  // without depending on `theme`/`accent` (which would retrigger on user changes).
  const localThemeRef = useRef<Theme>(theme);
  const localAccentRef = useRef<AccentKey>(accent);
  localThemeRef.current = theme;
  localAccentRef.current = accent;

  // Remote → Local: apply DB preferences to local state once loaded.
  // Dependency array intentionally excludes `theme` and `accent` so that
  // user-initiated local changes do not retrigger this effect.
  useEffect(() => {
    if (loading) return;

    const remoteTheme = prefs.theme;

    const remoteAccent = ACCENT_COLORS.some(
      (color) => color.key === prefs.accent_color
    )
      ? (prefs.accent_color as AccentKey)
      : 'teal';

    lastRemoteThemeRef.current = remoteTheme;
    lastRemoteAccentRef.current = remoteAccent;

    if (localThemeRef.current !== remoteTheme) {
      skipThemePersistRef.current = true;
      setTheme(remoteTheme);
    }

    if (localAccentRef.current !== remoteAccent) {
      skipAccentPersistRef.current = true;
      setAccent(remoteAccent);
    }

    hydratedRef.current = true;
  }, [loading, prefs.theme, prefs.accent_color, setTheme, setAccent]);

  // Local → Remote: persist user-initiated theme changes to DB.
  useEffect(() => {
    if (loading || !hydratedRef.current) return;

    if (skipThemePersistRef.current) {
      skipThemePersistRef.current = false;
      return;
    }

    if (lastRemoteThemeRef.current === theme) return;

    const previousRemote = lastRemoteThemeRef.current;
    lastRemoteThemeRef.current = theme;

    void updatePrefs({ theme }).catch((error) => {
      console.error(
        '[AuthenticatedThemeSync] failed to persist theme',
        error
      );
      lastRemoteThemeRef.current = previousRemote;
    });
  }, [theme, loading, updatePrefs]);

  // Local → Remote: persist user-initiated accent changes to DB.
  useEffect(() => {
    if (loading || !hydratedRef.current) return;

    if (skipAccentPersistRef.current) {
      skipAccentPersistRef.current = false;
      return;
    }

    if (lastRemoteAccentRef.current === accent) return;

    const previousRemote = lastRemoteAccentRef.current;
    lastRemoteAccentRef.current = accent;

    void updatePrefs({ accent_color: accent }).catch((error) => {
      console.error(
        '[AuthenticatedThemeSync] failed to persist accent_color',
        error
      );
      lastRemoteAccentRef.current = previousRemote;
    });
  }, [accent, loading, updatePrefs]);

  return null;
}
