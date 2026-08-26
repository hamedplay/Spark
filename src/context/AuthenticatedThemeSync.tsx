import { useEffect, useRef } from 'react';
import { useTheme, type Theme } from './ThemeContext';
import { useUserPreferences } from '../features/user-preferences';

/**
 * Bridge for authenticated per-user theme preferences.
 *
 * Light/dark remains a per-user preference. The global accent is hydrated by
 * ThemeProvider from system_config.appearance.primary_color for both login and
 * authenticated screens, so it intentionally does not participate here.
 */
export function AuthenticatedThemeSync() {
  const { prefs, loading, updatePrefs } = useUserPreferences();
  const { theme, setTheme } = useTheme();

  const skipThemePersistRef = useRef(false);
  const hydratedRef = useRef(false);
  const lastRemoteThemeRef = useRef<Theme | null>(null);

  // Mirror current local theme without making the remote hydration effect depend
  // on user-initiated local changes.
  const localThemeRef = useRef<Theme>(theme);
  localThemeRef.current = theme;

  // Remote → Local: apply the persisted per-user light/dark preference.
  useEffect(() => {
    if (loading) return;

    const remoteTheme = prefs.theme;
    lastRemoteThemeRef.current = remoteTheme;

    if (localThemeRef.current !== remoteTheme) {
      skipThemePersistRef.current = true;
      setTheme(remoteTheme);
    }

    hydratedRef.current = true;
  }, [loading, prefs.theme, setTheme]);

  // Local → Remote: persist only user-initiated light/dark changes.
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

  return null;
}
