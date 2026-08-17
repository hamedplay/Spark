export type DefaultCalendarView =
  | 'month'
  | 'week'
  | 'day'
  | 'list';

export type DefaultLandingPage =
  | 'calendar'
  | 'meetings'
  | 'tasks'
  | 'dashboard';

export type UserPreferenceTheme =
  | 'light'
  | 'dark';

export interface UserPreferences {
  default_calendar_view:
    DefaultCalendarView;

  default_landing_page:
    DefaultLandingPage;

  reminder_minutes: number;

  show_past_meetings: boolean;
  show_cancelled_meetings: boolean;
  compact_cards: boolean;
  notifications_enabled: boolean;

  theme: UserPreferenceTheme;
  accent_color: string;

  hide_offhours: boolean;

  work_start_time:
    string | null;

  work_end_time:
    string | null;
}

export type UserPreferencesPatch =
  Partial<UserPreferences>;

export const DEFAULT_USER_PREFERENCES:
  UserPreferences = {
  default_calendar_view: 'month',
  default_landing_page: 'calendar',
  reminder_minutes: 15,

  show_past_meetings: true,
  show_cancelled_meetings: false,
  compact_cards: false,
  notifications_enabled: true,

  theme: 'light',
  accent_color: 'teal',

  hide_offhours: false,
  work_start_time: null,
  work_end_time: null,
};

export interface UserPreferencesRow {
  default_calendar_view?: unknown;
  default_landing_page?: unknown;
  reminder_minutes?: unknown;

  show_past_meetings?: unknown;
  show_cancelled_meetings?: unknown;
  compact_cards?: unknown;
  notifications_enabled?: unknown;

  theme?: unknown;
  accent_color?: unknown;

  hide_offhours?: unknown;
  work_start_time?: unknown;
  work_end_time?: unknown;
}
