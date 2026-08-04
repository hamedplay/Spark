import { useEffect, useRef } from 'react';
import { useTheme, type AccentKey } from './ThemeContext';
import { useUserPreferences } from '../features/user-preferences';
import { ACCENT_COLORS } from './ThemeContext';

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

  // Remote → Local: apply DB preferences to local state once loaded.
  useEffect(() => {
    if (loading) return;

    const validAccent = ACCENT_COLORS.some((c) => c.key === prefs.accent_color)
      ? (prefs.accent_color as AccentKey)
      : 'teal';

    lastRemoteThemeRef.current = prefs.theme;
    lastRemoteAccentRef.current = validAccent;

    if (prefs.theme !== theme) {
      skipThemePersistRef.current = true;
      setTheme(prefs.theme);
    }

    if (validAccent !== accent) {
      skipAccentPersistRef.current = true;
      setAccent(validAccent);
    }

    hydratedRef.current = true;
  }, [loading, prefs.theme, prefs.accent_color, theme, accent, setTheme, setAccent]);

  // Local → Remote: persist user-initiated theme changes to DB.
  useEffect(() => {
    if (loading || !hydratedRef.current) return;

    if (skipThemePersistRef.current) {
      skipThemePersistRef.current = false;
      return;
    }

    if (lastRemoteThemeRef.current === theme) return;

    lastRemoteThemeRef.current = theme;
    updatePrefs({ theme }).catch((err) => {
      console.error('[AuthenticatedThemeSync] failed to persist theme', err);
      lastRemoteThemeRef.current = null;
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

    lastRemoteAccentRef.current = accent;
    updatePrefs({ accent_color: accent }).catch((err) => {
      console.error('[AuthenticatedThemeSync] failed to persist accent_color', err);
      lastRemoteAccentRef.current = null;
    });
  }, [accent, loading, updatePrefs]);

  return null;
}

type Theme = 'light' | 'dark';
