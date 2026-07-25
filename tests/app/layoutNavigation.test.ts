import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getVisiblePrimaryNavigationItems,
  getVisibleMinutesNavigationItems,
  isMinutesPage,
  resolveActiveMinutesPage,
} from '../../src/app/layout/navigationMenu';

test('preserves the primary navigation order', () => {
  const items = getVisiblePrimaryNavigationItems({
    isAdmin: true,
    sparkVisible: true,
    userPermissions: null,
  });

  assert.deepEqual(
    items.map(i => i.id),
    [
      'meetings',
      'calendar',
      'chat',
      'channels',
      'video-conference',
      'tasks',
      'notes',
      'contacts',
      'reports',
      'spark',
    ]
  );
});

test('hides Spark when the Spark visibility flag is false', () => {
  const items = getVisiblePrimaryNavigationItems({
    isAdmin: true,
    sparkVisible: false,
    userPermissions: null,
  });

  assert.ok(
    !items.some(i => i.id === 'spark')
  );
});

test('shows Spark when visible and permitted', () => {
  const items = getVisiblePrimaryNavigationItems({
    isAdmin: false,
    sparkVisible: true,
    userPermissions: { spark: true },
  });

  assert.ok(
    items.some(i => i.id === 'spark')
  );
});

test('allows administrators to see all non-Spark-hidden items', () => {
  const items = getVisiblePrimaryNavigationItems({
    isAdmin: true,
    sparkVisible: true,
    userPermissions: undefined,
  });

  assert.equal(items.length, 10);
});

test('treats null permissions as full access', () => {
  const items = getVisiblePrimaryNavigationItems({
    isAdmin: false,
    sparkVisible: true,
    userPermissions: null,
  });

  assert.equal(items.length, 10);
});

test('hides permissioned primary items while permissions are loading', () => {
  const items = getVisiblePrimaryNavigationItems({
    isAdmin: false,
    sparkVisible: true,
    userPermissions: undefined,
  });

  assert.equal(items.length, 0);
});

test('preserves partial-permission filtering without sorting', () => {
  const items = getVisiblePrimaryNavigationItems({
    isAdmin: false,
    sparkVisible: true,
    userPermissions: {
      meetings: true,
      tasks: true,
      reports: true,
    },
  });

  assert.deepEqual(
    items.map(i => i.id),
    ['meetings', 'tasks', 'reports']
  );
});

test('preserves Minutes submenu visibility and internal-page mapping', () => {
  const items = getVisibleMinutesNavigationItems({
    isAdmin: false,
    sparkVisible: false,
    userPermissions: undefined,
  });

  assert.equal(items.length, 6);

  assert.deepEqual(
    items.map(i => i.id),
    [
      'minutes-dashboard',
      'minutes',
      'minutes-approvals',
      'minutes-my-decisions',
      'minutes-followup',
      'minutes-reports',
    ]
  );

  assert.equal(
    resolveActiveMinutesPage('minutes-new'),
    'minutes'
  );
  assert.equal(
    resolveActiveMinutesPage('minutes-edit'),
    'minutes'
  );
  assert.equal(
    resolveActiveMinutesPage('minutes-detail'),
    'minutes'
  );
  assert.equal(
    resolveActiveMinutesPage('minutes-report'),
    'minutes-reports'
  );
  assert.equal(
    resolveActiveMinutesPage('minutes'),
    'minutes'
  );
  assert.equal(
    isMinutesPage('minutes'),
    true
  );
  assert.equal(
    isMinutesPage('meetings'),
    false
  );
});
