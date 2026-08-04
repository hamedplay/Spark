import { useEffect, useRef } from 'react';
import { ThemeProvider, useTheme, type AccentKey } from './ThemeContext';
import { useUserPreferences } from '../features/user-preferences';
import type { UserPreferenceTheme } from '../features/user-preferences';

/**
 * Wraps the pure ThemeProvider and syncs theme/accent from user preferences.
 * Must be used INSIDE a UserPreferencesProvider.
 * Prevents loops by tracking whether a DB sync is in progress.
 */
export function AuthenticatedThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <ThemeSync>{children}</ThemeSync>
    </ThemeProvider>
  );
}

function ThemeSync({ children }: { children: React.ReactNode }) {
  const { prefs, updatePrefs } = useUserPreferences();
  const { theme, toggleTheme, accent, setAccent } = useTheme();

  // Track whether we are applying a DB-loaded value to local state.
  // This prevents the effect from writing back to the DB on the same cycle.
  const syncingFromDb = useRef(false);

  // When prefs load (or change from an external source), apply to local theme provider.
  useEffect(() => {
    if (prefs.theme && prefs.theme !== theme) {
      syncingFromDb.current = true;
      // Apply the DB theme to local state by toggling if needed.
      if (prefs.theme === 'dark' && theme === 'light') toggleTheme();
      else if (prefs.theme === 'light' && theme === 'dark') toggleTheme();
      syncingFromDb.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.theme]);

  useEffect(() => {
    if (prefs.accent_color && prefs.accent_color !== accent) {
      syncingFromDb.current = true;
      setAccent(prefs.accent_color as AccentKey);
      syncingFromDb.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.accent_color]);

  // When user toggles theme locally, persist to DB (but not while syncing from DB).
  useEffect(() => {
    if (syncingFromDb.current) return;
    const currentDbTheme = prefs.theme as UserPreferenceTheme | undefined;
    if (currentDbTheme && currentDbTheme !== theme) {
      updatePrefs({ theme }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // When user changes accent locally, persist to DB.
  useEffect(() => {
    if (syncingFromDb.current) return;
    if (prefs.accent_color && prefs.accent_color !== accent) {
      updatePrefs({ accent_color: accent }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent]);

  return <>{children}</>;
}
