import { NAV_ITEMS } from '../../src/components/PortalConfig/constants';
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

test('one event center remains in actual configuration navigation', () => {
  const sections = NAV_ITEMS.flatMap(group => group.sub.map(section => section.key));
  assert.equal(sections.filter(key => key === 'group_events').length, 1);
  assert.equal(sections.includes('audit_log'), false);
  assert.equal(NAV_ITEMS.some(group => group.key === 'audit'), false);
});

test('legacy audit readers reach the unified center without changing persisted grants', () => {
  for (const key of ['config_users.group_events', 'config_audit.audit_log']) {
    const permissions = { config_view: true, [key]: true };
    assert.equal(canAccessConfigSection('group_events', false, permissions), true);
    const visible = getVisibleConfigNavigationItems(NAV_ITEMS, false, permissions);
    assert.deepEqual(visible.map(group => ({ key: group.key, sub: group.sub.map(section => section.key) })),
      [{ key: 'users', sub: ['group_events'] }]);
  }
});

test('consolidation grants no access to ordinary users or unrelated config sections', () => {
  assert.equal(canAccessConfigSection('group_events', false, { config_view: true }), false);
  assert.equal(canAccessConfigSection('group_events', false, undefined), false);
  assert.equal(canAccessConfigSection('users_list', false, { 'config_audit.audit_log': true }), false);
  assert.equal(canAccessConfigSection('group_events', false, { 'config_users.group_events': false, 'config_audit.audit_log': false }), false);
});
