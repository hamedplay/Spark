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
    minutesFollowupAllowed: true,
    minutesFollowupAccessLoading: false,
  });

  assert.deepEqual(
    items.map(i => i.id),
    [
      'management-dashboard',
      'meetings',
      'calendar',
      'minutes-hub',
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
    minutesFollowupAllowed: true,
    minutesFollowupAccessLoading: false,
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
    minutesFollowupAllowed: false,
    minutesFollowupAccessLoading: false,
  });

  assert.ok(
    items.some(i => i.id === 'spark')
  );
});

test('shows management dashboard only when its dedicated permission is granted', () => {
  const allowed = getVisiblePrimaryNavigationItems({
    isAdmin: false,
    sparkVisible: true,
    userPermissions: { management_dashboard: true },
  });
  const denied = getVisiblePrimaryNavigationItems({
    isAdmin: false,
    sparkVisible: true,
    userPermissions: { management_dashboard: false, meetings: true },
  });

  assert.ok(allowed.some(i => i.id === 'management-dashboard'));
  assert.ok(!denied.some(i => i.id === 'management-dashboard'));
});

test('allows administrators to see all non-Spark-hidden items', () => {
  const items = getVisiblePrimaryNavigationItems({
    isAdmin: true,
    sparkVisible: true,
    userPermissions: undefined,
    minutesFollowupAllowed: true,
    minutesFollowupAccessLoading: false,
  });

  assert.equal(items.length, 12);
});

test('treats null permissions as full access', () => {
  const items = getVisiblePrimaryNavigationItems({
    isAdmin: false,
    sparkVisible: true,
    userPermissions: null,
    minutesFollowupAllowed: true,
    minutesFollowupAccessLoading: false,
  });

  assert.equal(items.length, 12);
});

test('hides permissioned primary items while permissions are loading', () => {
  const items = getVisiblePrimaryNavigationItems({
    isAdmin: false,
    sparkVisible: true,
    userPermissions: undefined,
    minutesFollowupAllowed: false,
    minutesFollowupAccessLoading: true,
  });

  assert.equal(items.length, 0);
});

test('preserves partial-permission filtering without sorting', () => {
  const items = getVisiblePrimaryNavigationItems({
    isAdmin: false,
    sparkVisible: true,
    userPermissions: {
      management_dashboard: true,
      meetings: true,
      tasks: true,
      reports: true,
    },
    minutesFollowupAllowed: false,
    minutesFollowupAccessLoading: false,
  });

  assert.deepEqual(
    items.map(i => i.id),
    ['management-dashboard', 'meetings', 'tasks', 'reports']
  );
});

test('preserves Minutes navigation visibility and hub mapping', () => {
  const items = getVisibleMinutesNavigationItems({
    isAdmin: true,
    sparkVisible: false,
    userPermissions: undefined,
    minutesFollowupAllowed: true,
    minutesFollowupAccessLoading: false,
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
    'minutes-hub'
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
