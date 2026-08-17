import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Tests for the URL cleanup rules applied by the central navigate function.
 *
 * These tests simulate the browser URL/sessionStorage environment and verify
 * that `clearMinutesContextFromUrl` and the navigation cleanup rules work correctly
 * for each page transition scenario.
 *
 * We test the pure logic by simulating URL manipulation with a minimal mock.
 */

// ── Mock environment ─────────────────────────────────────────────────────────

function setupMockUrl(urlStr: string) {
  const url = new URL(urlStr);

  // Mock window.location
  (globalThis as Record<string, unknown>).window = {
    location: url,
    history: {
      replaceState: (_state: unknown, _title: string, newUrl: string) => {
        const u = new URL(newUrl, url.origin);
        url.search = u.search;
        url.pathname = u.pathname;
      },
      pushState: (_state: unknown, _title: string, newUrl: string) => {
        const u = new URL(newUrl, url.origin);
        url.search = u.search;
        url.pathname = u.pathname;
      },
    },
  };

  // Mock sessionStorage
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  };

  return { url, store };
}

function getUrlParams(url: URL): URLSearchParams {
  return url.searchParams;
}

// ── Import the functions under test ───────────────────────────────────────────
// We import from the source module directly.

import {
  clearMinutesContextFromUrl,
  setMinutesPageInUrl,
  setMinuteIdInUrl,
  setMinutesTabInUrl,
  getMinuteIdFromUrl,
  getMinutesTabFromUrl,
  getMeetingIdFromUrl,
  setMeetingIdInUrl,
  getMinutesPageFromUrl,
  stripMpageFromUrl,
} from '../../src/lib/minutesNavigation';

// ── Tests ─────────────────────────────────────────────────────────────────────

test('clearMinutesContextFromUrl removes mpage, minute, mtab, meeting and sessionStorage', () => {
  const { url, store } = setupMockUrl('https://app.example.com/?mpage=minutes-detail&minute=abc-123&mtab=final_version&meeting=def-456');
  store['selectedMinuteId'] = 'abc-123';

  clearMinutesContextFromUrl();

  const params = getUrlParams(url);
  assert.equal(params.get('mpage'), null);
  assert.equal(params.get('minute'), null);
  assert.equal(params.get('mtab'), null);
  assert.equal(params.get('meeting'), null);
  assert.equal(store['selectedMinuteId'], undefined);
});

test('clearMinutesContextFromUrl preserves non-minutes params', () => {
  const { url, store } = setupMockUrl('https://app.example.com/?mpage=minutes-detail&minute=abc&tab=some&other=value');
  store['selectedMinuteId'] = 'abc';

  clearMinutesContextFromUrl();

  const params = getUrlParams(url);
  assert.equal(params.get('other'), 'value');
  // 'tab' is not a minutes param, should be preserved
  assert.equal(params.get('tab'), 'some');
});

test('direct link to minutes-detail preserves minute and mtab after refresh (mpage stripped)', () => {
  const { url } = setupMockUrl('https://app.example.com/?mpage=minutes-detail&minute=ced1d52c&mtab=final_version');

  // Simulate: page loads, stripMpageFromUrl runs, then getMinuteIdFromUrl/getMinutesTabFromUrl
  stripMpageFromUrl();
  assert.equal(getMinuteIdFromUrl(), 'ced1d52c');
  assert.equal(getMinutesTabFromUrl(), 'final_version');

  const params = getUrlParams(url);
  assert.equal(params.get('mpage'), null, 'mpage stripped on load');
  assert.equal(params.get('minute'), 'ced1d52c');
  assert.equal(params.get('mtab'), 'final_version');
});

test('navigate from minutes-detail to calendar clears all minutes context', () => {
  const { url, store } = setupMockUrl('https://app.example.com/?mpage=minutes-detail&minute=ced1d52c&mtab=final_version&meeting=def-456');
  store['selectedMinuteId'] = 'ced1d52c';

  // Simulate navigate('calendar') — which calls clearMinutesContextFromUrl for non-minutes pages
  clearMinutesContextFromUrl();

  const params = getUrlParams(url);
  assert.equal(params.get('mpage'), null);
  assert.equal(params.get('minute'), null);
  assert.equal(params.get('mtab'), null);
  assert.equal(params.get('meeting'), null);
  assert.equal(store['selectedMinuteId'], undefined);
});

test('setMinutesPageInUrl is a no-op (mpage not written to URL)', () => {
  const { url } = setupMockUrl('https://app.example.com/?minute=abc');
  setMinutesPageInUrl('minutes-detail');
  const params = getUrlParams(url);
  assert.equal(params.get('mpage'), null, 'mpage should NOT be in URL after setMinutesPageInUrl');
  assert.equal(params.get('minute'), 'abc', 'other params preserved');
});

test('getMinutesPageFromUrl always returns null', () => {
  setupMockUrl('https://app.example.com/?mpage=minutes-detail');
  assert.equal(getMinutesPageFromUrl(), null);
});

test('stripMpageFromUrl removes only mpage, preserves other params and hash', () => {
  const { url } = setupMockUrl('https://app.example.com/?mpage=minutes-dashboard&other=value#section');
  stripMpageFromUrl();
  const params = getUrlParams(url);
  assert.equal(params.get('mpage'), null, 'mpage removed');
  assert.equal(params.get('other'), 'value', 'other param preserved');
  assert.equal(url.hash, '#section', 'hash preserved');
});

test('stripMpageFromUrl does nothing if mpage not present', () => {
  const { url } = setupMockUrl('https://app.example.com/?other=value');
  stripMpageFromUrl();
  const params = getUrlParams(url);
  assert.equal(params.get('mpage'), null);
  assert.equal(params.get('other'), 'value');
});

test('navigate from minutes-detail to minutes list clears minute and mtab but does NOT set mpage', () => {
  const { url, store } = setupMockUrl('https://app.example.com/?mpage=minutes-detail&minute=ced1d52c&mtab=final_version');
  store['selectedMinuteId'] = 'ced1d52c';

  // Simulate navigate('minutes') — general minutes page cleanup (no mpage written)
  const url2 = new URL(url.toString());
  url2.searchParams.delete('minute');
  url2.searchParams.delete('meeting');
  url2.searchParams.delete('mtab');
  url2.searchParams.delete('mpage');
  window.history.replaceState({}, '', url2.toString());
  sessionStorage.removeItem('selectedMinuteId');

  const params = getUrlParams(url);
  assert.equal(params.get('mpage'), null, 'mpage should NOT be set');
  assert.equal(params.get('minute'), null);
  assert.equal(params.get('mtab'), null);
  assert.equal(store['selectedMinuteId'], undefined);
});

test('navigate to minutes-edit preserves minute but clears mtab and meeting, no mpage', () => {
  const { url } = setupMockUrl('https://app.example.com/?mpage=minutes-detail&minute=ced1d52c&mtab=final_version&meeting=def-456');

  // Simulate navigate('minutes-edit') — preserve minute, clear mtab and meeting (no mpage)
  const minuteId = getMinuteIdFromUrl();
  if (minuteId) setMinuteIdInUrl(minuteId);
  const url2 = new URL(url.toString());
  url2.searchParams.delete('mtab');
  url2.searchParams.delete('meeting');
  url2.searchParams.delete('mpage');
  window.history.replaceState({}, '', url2.toString());

  const params = getUrlParams(url);
  assert.equal(params.get('mpage'), null, 'mpage should NOT be set');
  assert.equal(params.get('minute'), 'ced1d52c');
  assert.equal(params.get('mtab'), null);
  assert.equal(params.get('meeting'), null);
});

test('navigate to minutes-new preserves meeting but clears minute, mtab, selectedMinuteId, no mpage', () => {
  const { url, store } = setupMockUrl('https://app.example.com/?mpage=minutes&meeting=def-456&minute=ced1d52c&mtab=final_version');
  store['selectedMinuteId'] = 'ced1d52c';

  // Simulate navigate('minutes-new') — preserve meeting, clear rest (no mpage)
  const meetingId = getMeetingIdFromUrl();
  if (meetingId) setMeetingIdInUrl(meetingId);
  const url2 = new URL(url.toString());
  url2.searchParams.delete('minute');
  url2.searchParams.delete('mtab');
  url2.searchParams.delete('mpage');
  window.history.replaceState({}, '', url2.toString());
  sessionStorage.removeItem('selectedMinuteId');

  const params = getUrlParams(url);
  assert.equal(params.get('mpage'), null, 'mpage should NOT be set');
  assert.equal(params.get('meeting'), 'def-456');
  assert.equal(params.get('minute'), null);
  assert.equal(params.get('mtab'), null);
  assert.equal(store['selectedMinuteId'], undefined);
});

test('navigate from calendar to minutes-new preserves meeting param, no mpage', () => {
  const { url, store } = setupMockUrl('https://app.example.com/?meeting=def-456');
  store['selectedMinuteId'] = 'old-id';

  // Simulate navigate('minutes-new') from calendar (no mpage)
  const meetingId = getMeetingIdFromUrl();
  if (meetingId) setMeetingIdInUrl(meetingId);
  const url2 = new URL(url.toString());
  url2.searchParams.delete('minute');
  url2.searchParams.delete('mtab');
  window.history.replaceState({}, '', url2.toString());
  sessionStorage.removeItem('selectedMinuteId');

  const params = getUrlParams(url);
  assert.equal(params.get('mpage'), null, 'mpage should NOT be set');
  assert.equal(params.get('meeting'), 'def-456');
  assert.equal(params.get('minute'), null);
  assert.equal(store['selectedMinuteId'], undefined);
});

test('refresh on calendar does not reopen previous minutes detail', () => {
  // After navigating from minutes-detail to calendar, the URL should have no minutes params
  const { url, store } = setupMockUrl('https://app.example.com/');
  // Simulate state after navigate('calendar') from minutes-detail
  clearMinutesContextFromUrl();
  store['selectedMinuteId'] = 'should-be-gone';
  sessionStorage.removeItem('selectedMinuteId');

  const params = getUrlParams(url);
  assert.equal(params.get('mpage'), null);
  assert.equal(params.get('minute'), null);
  assert.equal(params.get('mtab'), null);
  assert.equal(store['selectedMinuteId'], undefined);

  // On refresh, getMinuteIdFromUrl returns null — no minute to reopen
  assert.equal(getMinuteIdFromUrl(), null);
});

test('direct link to minutes-detail with final_version tab survives refresh (mpage stripped)', () => {
  const { url } = setupMockUrl('https://app.example.com/?mpage=minutes-detail&minute=ced1d52c-b251-4b28-8a7d-c7c02f4ebf2f&mtab=final_version');

  // After refresh, stripMpageFromUrl runs, then params should be intact (except mpage)
  stripMpageFromUrl();
  const params = getUrlParams(url);
  assert.equal(params.get('mpage'), null, 'mpage stripped');
  assert.equal(params.get('minute'), 'ced1d52c-b251-4b28-8a7d-c7c02f4ebf2f');
  assert.equal(params.get('mtab'), 'final_version');

  assert.equal(getMinuteIdFromUrl(), 'ced1d52c-b251-4b28-8a7d-c7c02f4ebf2f');
  assert.equal(getMinutesTabFromUrl(), 'final_version');
});
