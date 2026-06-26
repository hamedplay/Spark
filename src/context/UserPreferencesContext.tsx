import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

export interface UserPreferences {
  default_calendar_view: 'month' | 'week' | 'day' | 'list';
  default_landing_page: 'calendar' | 'meetings' | 'tasks' | 'dashboard';
  reminder_minutes: number;
  show_past_meetings: boolean;
  show_cancelled_meetings: boolean;
  compact_cards: boolean;
  notifications_enabled: boolean;
  theme: 'light' | 'dark';
  accent_color: string;
  hide_off_hours: boolean;
}

const DEFAULTS: UserPreferences = {
  default_calendar_view: 'month',
  default_landing_page: 'calendar',
  reminder_minutes: 15,
  show_past_meetings: true,
  show_cancelled_meetings: false,
  compact_cards: false,
  notifications_enabled: true,
  theme: 'light',
  accent_color: 'teal',
  hide_off_hours: false,
};

interface UserPreferencesContextValue {
  prefs: UserPreferences;
  loading: boolean;
  updatePrefs: (patch: Partial<UserPreferences>) => Promise<void>;
}

const UserPreferencesContext = createContext<UserPreferencesContextValue>({
  prefs: DEFAULTS,
  loading: true,
  updatePrefs: async () => {},
});

function mapRow(data: Record<string, unknown>): UserPreferences {
  return {
    default_calendar_view: (data.default_calendar_view as UserPreferences['default_calendar_view']) ?? DEFAULTS.default_calendar_view,
    default_landing_page: (data.default_landing_page as UserPreferences['default_landing_page']) ?? DEFAULTS.default_landing_page,
    reminder_minutes: (data.reminder_minutes as number) ?? DEFAULTS.reminder_minutes,
    show_past_meetings: (data.show_past_meetings as boolean) ?? DEFAULTS.show_past_meetings,
    show_cancelled_meetings: (data.show_cancelled_meetings as boolean) ?? DEFAULTS.show_cancelled_meetings,
    compact_cards: (data.compact_cards as boolean) ?? DEFAULTS.compact_cards,
    notifications_enabled: (data.notifications_enabled as boolean) ?? DEFAULTS.notifications_enabled,
    theme: (data.theme as 'light' | 'dark') ?? DEFAULTS.theme,
    accent_color: (data.accent_color as string) ?? DEFAULTS.accent_color,
    hide_off_hours: (data.hide_off_hours as boolean) ?? DEFAULTS.hide_off_hours,
  };
}

export function UserPreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);

      const { data } = await supabase
        .from('user_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        const mapped = mapRow(data);
        setPrefs(mapped);
        // Seed localStorage so ThemeContext initializes with correct values on next render
        localStorage.setItem('theme', mapped.theme);
        localStorage.setItem('accent_color', mapped.accent_color);
      }
      setLoading(false);
    })();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setPrefs(DEFAULTS);
        setUserId(null);
        setLoading(false);
      } else {
        setUserId(session.user.id);
        (async () => {
          const { data } = await supabase
            .from('user_preferences')
            .select('*')
            .eq('user_id', session.user.id)
            .maybeSingle();
          if (data) {
            const mapped = mapRow(data);
            setPrefs(mapped);
            localStorage.setItem('theme', mapped.theme);
            localStorage.setItem('accent_color', mapped.accent_color);
          }
          setLoading(false);
        })();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const updatePrefs = useCallback(async (patch: Partial<UserPreferences>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);

    if (!userId) return;
    await supabase
      .from('user_preferences')
      .upsert({ user_id: userId, ...next, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  }, [prefs, userId]);

  return (
    <UserPreferencesContext.Provider value={{ prefs, loading, updatePrefs }}>
      {children}
    </UserPreferencesContext.Provider>
  );
}

export function useUserPreferences() {
  return useContext(UserPreferencesContext);
}
