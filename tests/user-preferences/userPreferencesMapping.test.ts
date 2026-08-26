import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
  type UserPreferencesRow,
} from '../../src/features/user-preferences/types/userPreferences';
import {
  mapUserPreferencesRow,
  mergeUserPreferences,
} from '../../src/features/user-preferences/mappers/mapUserPreferencesRow';

test('exposes the exact legacy default preferences', () => {
  assert.deepEqual(
    DEFAULT_USER_PREFERENCES,
    {
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
    }
  );
});

test('maps a complete preferences row', () => {
  const row: UserPreferencesRow = {
    default_calendar_view: 'week',
    default_landing_page: 'meetings',
    reminder_minutes: 30,
    show_past_meetings: false,
    show_cancelled_meetings: true,
    compact_cards: true,
    notifications_enabled: false,
    theme: 'dark',
    accent_color: 'blue',
    hide_offhours: true,
    work_start_time: '08:00',
    work_end_time: '17:00',
  };

  const result = mapUserPreferencesRow(row);

  assert.equal(result.default_calendar_view, 'week');
  assert.equal(result.default_landing_page, 'meetings');
  assert.equal(result.reminder_minutes, 30);
  assert.equal(result.show_past_meetings, false);
  assert.equal(result.show_cancelled_meetings, true);
  assert.equal(result.compact_cards, true);
  assert.equal(result.notifications_enabled, false);
  assert.equal(result.theme, 'dark');
  assert.equal(result.accent_color, 'blue');
  assert.equal(result.hide_offhours, true);
  assert.equal(result.work_start_time, '08:00');
  assert.equal(result.work_end_time, '17:00');
});

test('falls back only for nullish row values', () => {
  const row: UserPreferencesRow = {
    default_calendar_view: undefined,
    default_landing_page: null,
    reminder_minutes: undefined,
    show_past_meetings: null,
    show_cancelled_meetings: undefined,
    compact_cards: null,
    notifications_enabled: undefined,
    theme: null,
    accent_color: undefined,
    hide_offhours: null,
    work_start_time: undefined,
    work_end_time: null,
  };

  const result = mapUserPreferencesRow(row);

  assert.equal(result.default_calendar_view, 'month');
  assert.equal(result.default_landing_page, 'calendar');
  assert.equal(result.reminder_minutes, 15);
  assert.equal(result.show_past_meetings, true);
  assert.equal(result.show_cancelled_meetings, false);
  assert.equal(result.compact_cards, false);
  assert.equal(result.notifications_enabled, true);
  assert.equal(result.theme, 'light');
  assert.equal(result.accent_color, 'teal');
  assert.equal(result.hide_offhours, false);
  assert.equal(result.work_start_time, null);
  assert.equal(result.work_end_time, null);
});

test('preserves false boolean values', () => {
  const row: UserPreferencesRow = {
    show_past_meetings: false,
    show_cancelled_meetings: false,
    compact_cards: false,
    notifications_enabled: false,
    hide_offhours: false,
  };

  const result = mapUserPreferencesRow(row);

  assert.equal(result.show_past_meetings, false);
  assert.equal(result.show_cancelled_meetings, false);
  assert.equal(result.compact_cards, false);
  assert.equal(result.notifications_enabled, false);
  assert.equal(result.hide_offhours, false);
});

test('preserves zero reminder minutes', () => {
  const row: UserPreferencesRow = {
    reminder_minutes: 0,
  };

  const result = mapUserPreferencesRow(row);

  assert.equal(result.reminder_minutes, 0);
});

test('preserves nullable and empty work-hour values', () => {
  const rowWithNull: UserPreferencesRow = {
    work_start_time: null,
    work_end_time: null,
  };
  const resultNull = mapUserPreferencesRow(rowWithNull);
  assert.equal(resultNull.work_start_time, null);
  assert.equal(resultNull.work_end_time, null);

  const rowWithEmpty: UserPreferencesRow = {
    work_start_time: '',
    work_end_time: '',
  };
  const resultEmpty = mapUserPreferencesRow(rowWithEmpty);
  assert.equal(resultEmpty.work_start_time, '');
  assert.equal(resultEmpty.work_end_time, '');
});

test('preserves asserted enum strings without runtime validation', () => {
  const row: UserPreferencesRow = {
    default_calendar_view:
      'invalid-view' as unknown,
    default_landing_page:
      'invalid-page' as unknown,
    theme: 'invalid-theme' as unknown,
  };

  const result = mapUserPreferencesRow(row);

  assert.equal(
    result.default_calendar_view,
    'invalid-view'
  );
  assert.equal(
    result.default_landing_page,
    'invalid-page'
  );
  assert.equal(result.theme, 'invalid-theme');
});

test('merges a patch without mutating either input', () => {
  const current: UserPreferences = {
    ...DEFAULT_USER_PREFERENCES,
    reminder_minutes: 15,
    theme: 'light',
  };

  const patch = { reminder_minutes: 30, theme: 'dark' };

  const result = mergeUserPreferences(current, patch);

  assert.equal(result.reminder_minutes, 30);
  assert.equal(result.theme, 'dark');
  assert.equal(current.reminder_minutes, 15);
  assert.equal(current.theme, 'light');
  assert.equal(patch.reminder_minutes, 30);
  assert.equal(patch.theme, 'dark');
});
