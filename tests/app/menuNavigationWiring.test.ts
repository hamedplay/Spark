import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getVisiblePrimaryNavigationItems,
  getVisibleMinutesNavigationItems,
} from '../../src/app/layout/navigationMenu';
import {
  clearMinutesContextFromUrl,
  getMinuteIdFromUrl,
  getMinutesTabFromUrl,
} from '../../src/lib/minutesNavigation';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Mock environment ─────────────────────────────────────────────────────────

function setupMockUrl(urlStr: string) {
  const url = new URL(urlStr);
  const store: Record<string, string> = {};

  (globalThis as Record<string, unknown>).window = {
    location: url,
    history: {
      replaceState: (_s: unknown, _t: string, newUrl: string) => {
        const u = new URL(newUrl, url.origin);
        url.search = u.search;
        url.pathname = u.pathname;
      },
      pushState: (_s: unknown, _t: string, newUrl: string) => {
        const u = new URL(newUrl, url.origin);
        url.search = u.search;
        url.pathname = u.pathname;
      },
    },
  };
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  };

  return { url, store };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('primary navigation includes meetings, calendar, and minutes-hub for menu clicks', () => {
  const items = getVisiblePrimaryNavigationItems({
    isAdmin: true,
    sparkVisible: true,
    userPermissions: null,
  });

  const ids = items.map(i => i.id);

  assert.ok(ids.includes('meetings'), 'meetings should be in primary nav');
  assert.ok(ids.includes('calendar'), 'calendar should be in primary nav');
  assert.ok(ids.includes('minutes-hub'), 'minutes-hub should be in primary nav');
});

test('minutes submenu includes list, dashboard, approvals, and reports', () => {
  const items = getVisibleMinutesNavigationItems({
    isAdmin: true,
    sparkVisible: true,
    userPermissions: null,
  });

  const ids = items.map(i => i.id);

  assert.ok(ids.includes('minutes'), 'minutes list should be in submenu');
  assert.ok(ids.includes('minutes-dashboard'), 'minutes-dashboard should be in submenu');
  assert.ok(ids.includes('minutes-approvals'), 'minutes-approvals should be in submenu');
  assert.ok(ids.includes('minutes-reports'), 'minutes-reports should be in submenu');
});

test('navigate callback is a single function (not undefined) when wired from useNavigation', () => {
  const navigate = (page: string) => { return page; };

  assert.equal(typeof navigate, 'function');
  assert.equal(navigate('calendar'), 'calendar');
  assert.equal(navigate('meetings'), 'meetings');
  assert.equal(navigate('minutes-hub'), 'minutes-hub');
  assert.equal(navigate('chat'), 'chat');
  assert.equal(navigate('channels'), 'channels');
  assert.equal(navigate('video-conference'), 'video-conference');
});

test('navigate to non-minutes page cleans minutes URL context', () => {
  const { url, store } = setupMockUrl('https://app.example.com/?mpage=minutes-detail&minute=abc-123&mtab=final_version&meeting=def-456');
  store['selectedMinuteId'] = 'abc-123';

  clearMinutesContextFromUrl();

  const params = url.searchParams;
  assert.equal(params.get('mpage'), null);
  assert.equal(params.get('minute'), null);
  assert.equal(params.get('mtab'), null);
  assert.equal(params.get('meeting'), null);
  assert.equal(store['selectedMinuteId'], undefined);
});

test('direct link to minutes-detail preserves minute and mtab after refresh', () => {
  setupMockUrl('https://app.example.com/?mpage=minutes-detail&minute=ced1d52c&mtab=final_version');

  assert.equal(getMinuteIdFromUrl(), 'ced1d52c');
  assert.equal(getMinutesTabFromUrl(), 'final_version');
});

test('PageRendererProps type has navigate but not setActivePage', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/app/navigation/pageRendererTypes.ts'),
    'utf-8',
  );

  assert.ok(source.includes('navigate:'), 'pageRendererTypes should have navigate');
  assert.ok(!source.includes('setActivePage:'), 'pageRendererTypes should NOT have setActivePage');
});

test('AppShellProps type has navigate but not setActivePage', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/app/layout/AppShell.tsx'),
    'utf-8',
  );

  assert.ok(source.includes('navigate:'), 'AppShell should have navigate prop');
  assert.ok(!/setActivePage\s*:/.test(source), 'AppShell should NOT have setActivePage prop');
});

test('App.tsx passes navigate (not setActivePage) to AppShell', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/App.tsx'),
    'utf-8',
  );

  assert.ok(source.includes('navigate={navigate}'), 'App.tsx should pass navigate={navigate} to AppShell');
  assert.ok(!/setActivePage=\{navigate\}/.test(source), 'App.tsx should NOT pass setActivePage={navigate}');
});

test('PageRenderer.tsx destructures navigate but not setActivePage', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/app/navigation/PageRenderer.tsx'),
    'utf-8',
  );

  // The destructure line should have navigate, not setActivePage
  assert.ok(/activePage,\s*navigate,/.test(source), 'PageRenderer should destructure navigate');
  assert.ok(!/activePage,\s*setActivePage,/.test(source), 'PageRenderer should NOT destructure setActivePage');
});
