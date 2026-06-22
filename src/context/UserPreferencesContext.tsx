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
}

const DEFAULTS: UserPreferences = {
  default_calendar_view: 'month',
  default_landing_page: 'calendar',
  reminder_minutes: 15,
  show_past_meetings: true,
  show_cancelled_meetings: false,
  compact_cards: false,
  notifications_enabled: true,
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
        setPrefs({
          default_calendar_view: data.default_calendar_view ?? DEFAULTS.default_calendar_view,
          default_landing_page: data.default_landing_page ?? DEFAULTS.default_landing_page,
          reminder_minutes: data.reminder_minutes ?? DEFAULTS.reminder_minutes,
          show_past_meetings: data.show_past_meetings ?? DEFAULTS.show_past_meetings,
          show_cancelled_meetings: data.show_cancelled_meetings ?? DEFAULTS.show_cancelled_meetings,
          compact_cards: data.compact_cards ?? DEFAULTS.compact_cards,
          notifications_enabled: data.notifications_enabled ?? DEFAULTS.notifications_enabled,
        });
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
            setPrefs({
              default_calendar_view: data.default_calendar_view ?? DEFAULTS.default_calendar_view,
              default_landing_page: data.default_landing_page ?? DEFAULTS.default_landing_page,
              reminder_minutes: data.reminder_minutes ?? DEFAULTS.reminder_minutes,
              show_past_meetings: data.show_past_meetings ?? DEFAULTS.show_past_meetings,
              show_cancelled_meetings: data.show_cancelled_meetings ?? DEFAULTS.show_cancelled_meetings,
              compact_cards: data.compact_cards ?? DEFAULTS.compact_cards,
              notifications_enabled: data.notifications_enabled ?? DEFAULTS.notifications_enabled,
            });
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
