import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessConfigSection,
  canOpenPortalConfig,
  getFirstVisibleConfigSection,
  getVisibleConfigNavigationItems,
} from '../../src/features/permissions/configPermissions';

const nav = [
  { key: 'users', sub: [{ key: 'users_list' }, { key: 'org_structure' }] },
  { key: 'audit', sub: [{ key: 'audit_log' }] },
];

test('config entry requires config_view for non-admin users', () => {
  assert.equal(canOpenPortalConfig(false, { 'config_users.users_list': true }), false);
  assert.equal(canOpenPortalConfig(false, { config_view: true }), true);
  assert.equal(canOpenPortalConfig(true, undefined), true);
  assert.equal(canOpenPortalConfig(false, null), true);
});

test('each config section uses its dedicated permission', () => {
  const permissions = { config_view: true, 'config_users.users_list': true };
  assert.equal(canAccessConfigSection('users_list', false, permissions), true);
  assert.equal(canAccessConfigSection('org_structure', false, permissions), false);
});

test('configuration navigation hides inaccessible groups and sections', () => {
  const visible = getVisibleConfigNavigationItems(nav, false, {
    config_view: true,
    'config_users.org_structure': true,
  });
  assert.deepEqual(visible, [{ key: 'users', sub: [{ key: 'org_structure' }] }]);
  assert.equal(getFirstVisibleConfigSection(visible), 'org_structure');
});

test('full access sees all configuration sections', () => {
  assert.deepEqual(getVisibleConfigNavigationItems(nav, false, null), nav);
});
