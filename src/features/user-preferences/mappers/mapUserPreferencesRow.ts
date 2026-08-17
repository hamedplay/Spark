import type {
  UserPreferences,
  UserPreferencesPatch,
  UserPreferencesRow,
} from '../types/userPreferences';
import {
  DEFAULT_USER_PREFERENCES,
} from '../types/userPreferences';

export function mapUserPreferencesRow(
  row: UserPreferencesRow
): UserPreferences {
  return {
    default_calendar_view:
      (
        row.default_calendar_view as
          UserPreferences[
            'default_calendar_view'
          ]
      ) ??
      DEFAULT_USER_PREFERENCES
        .default_calendar_view,

    default_landing_page:
      (
        row.default_landing_page as
          UserPreferences[
            'default_landing_page'
          ]
      ) ??
      DEFAULT_USER_PREFERENCES
        .default_landing_page,

    reminder_minutes:
      (row.reminder_minutes as number) ??
      DEFAULT_USER_PREFERENCES
        .reminder_minutes,

    show_past_meetings:
      (row.show_past_meetings as boolean) ??
      DEFAULT_USER_PREFERENCES
        .show_past_meetings,

    show_cancelled_meetings:
      (
        row.show_cancelled_meetings as boolean
      ) ??
      DEFAULT_USER_PREFERENCES
        .show_cancelled_meetings,

    compact_cards:
      (row.compact_cards as boolean) ??
      DEFAULT_USER_PREFERENCES
        .compact_cards,

    notifications_enabled:
      (
        row.notifications_enabled as boolean
      ) ??
      DEFAULT_USER_PREFERENCES
        .notifications_enabled,

    theme:
      (row.theme as UserPreferences['theme']) ??
      DEFAULT_USER_PREFERENCES.theme,

    accent_color:
      (row.accent_color as string) ??
      DEFAULT_USER_PREFERENCES
        .accent_color,

    hide_offhours:
      (row.hide_offhours as boolean) ??
      DEFAULT_USER_PREFERENCES
        .hide_offhours,

    work_start_time:
      (row.work_start_time as string | null) ??
      null,

    work_end_time:
      (row.work_end_time as string | null) ??
      null,
  };
}

export function mergeUserPreferences(
  current: UserPreferences,
  patch: UserPreferencesPatch
): UserPreferences {
  return {
    ...current,
    ...patch,
  };
}
