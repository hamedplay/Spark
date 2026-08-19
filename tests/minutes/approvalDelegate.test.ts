import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TEMPLATE_EVENTS,
  TEMPLATE_PLACEHOLDERS,
} from '../../src/config/templateCatalog';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Event type registry tests ─────────────────────────────────────────────────

test('minute_approval_delegate_assigned event exists with correct category and audiences', () => {
  const evt = TEMPLATE_EVENTS.find(e => e.key === 'minute_approval_delegate_assigned');
  assert.ok(evt, 'minute_approval_delegate_assigned should be in TEMPLATE_EVENTS');
  assert.equal(evt!.category, 'minutes');
  assert.ok(evt!.audiences.includes('approvers'));
});

test('minute_approval_delegate_assigned has sms supported', () => {
  const evt = TEMPLATE_EVENTS.find(e => e.key === 'minute_approval_delegate_assigned');
  assert.ok(evt);
  assert.ok(evt!.supportedChannels.includes('sms'), 'delegate assigned should support SMS');
});

test('minute_approval_delegate_assigned requires minute_title and original_approver_name', () => {
  const evt = TEMPLATE_EVENTS.find(e => e.key === 'minute_approval_delegate_assigned');
  assert.ok(evt);
  assert.ok(evt!.requiredPlaceholders.includes('minute_title'));
  assert.ok(evt!.requiredPlaceholders.includes('original_approver_name'));
});

test('minute_approver_delegate_selected event exists with correct category and audiences', () => {
  const evt = TEMPLATE_EVENTS.find(e => e.key === 'minute_approver_delegate_selected');
  assert.ok(evt, 'minute_approver_delegate_selected should be in TEMPLATE_EVENTS');
  assert.equal(evt!.category, 'minutes');
  for (const audience of ['creator', 'secretary', 'chair', 'approvers', 'all']) {
    assert.ok(evt!.audiences.includes(audience), `should allow audience: ${audience}`);
  }
});

test('minute_approver_delegate_selected requires original_approver_name, delegate_name, minute_title', () => {
  const evt = TEMPLATE_EVENTS.find(e => e.key === 'minute_approver_delegate_selected');
  assert.ok(evt);
  assert.ok(evt!.requiredPlaceholders.includes('minute_title'));
  assert.ok(evt!.requiredPlaceholders.includes('original_approver_name'));
  assert.ok(evt!.requiredPlaceholders.includes('delegate_name'));
});

test('delegate events do NOT use meeting category or change event type', () => {
  const delegateEvents = TEMPLATE_EVENTS.filter(
    e => e.key === 'minute_approval_delegate_assigned' || e.key === 'minute_approver_delegate_selected'
  );
  for (const evt of delegateEvents) {
    assert.equal(evt!.category, 'minutes');
    assert.ok(!evt!.key.includes('meeting'));
    assert.ok(!evt!.key.includes('change'));
  }
});

// ── Placeholder tests ─────────────────────────────────────────────────────────

test('original_approver_name placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'original_approver_name'));
});

test('delegate_name placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'delegate_name'));
});

test('actor_name placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'actor_name'));
});

test('minute_link placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'minute_link'));
});

test('recipient_greeting placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'recipient_greeting'));
});

test('full_name placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'full_name'));
});

test('minute_title placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'minute_title'));
});

test('minute_revision placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'minute_revision'));
});

// ── ApprovalRow type tests ────────────────────────────────────────────────────

test('ApprovalRow type includes delegate fields', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/Detail/types.ts'),
    'utf-8',
  );
  assert.ok(source.includes('delegate_user_id'), 'ApprovalRow should have delegate_user_id');
  assert.ok(source.includes('delegate_name'), 'ApprovalRow should have delegate_name');
  assert.ok(source.includes('delegated_by_user_id'), 'ApprovalRow should have delegated_by_user_id');
  assert.ok(source.includes('delegated_at'), 'ApprovalRow should have delegated_at');
  assert.ok(source.includes('acted_by_user_id'), 'ApprovalRow should have acted_by_user_id');
  assert.ok(source.includes('acted_by_name'), 'ApprovalRow should have acted_by_name');
});

// ── Migration source tests ────────────────────────────────────────────────────

test('migration adds delegate columns without dropping existing data', () => {
  // Check the latest migration file for the delegate columns
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return; // migrations may be applied via MCP only

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(migrationSource.includes('delegate_user_id'), 'migration should add delegate_user_id');
  assert.ok(migrationSource.includes('delegated_by_user_id'), 'migration should add delegated_by_user_id');
  assert.ok(migrationSource.includes('delegated_at'), 'migration should add delegated_at');
  assert.ok(migrationSource.includes('acted_by_user_id'), 'migration should add acted_by_user_id');
  assert.ok(migrationSource.includes('ON DELETE SET NULL'), 'FK should use SET NULL not CASCADE');
  assert.ok(!migrationSource.includes('DROP COLUMN'), 'migration should not drop columns');
  assert.ok(!migrationSource.includes('TRUNCATE'), 'migration should not truncate');
  assert.ok(!migrationSource.includes('DELETE FROM'), 'migration should not delete data');
});

test('migration creates assign_minutes_approval_delegate as SECURITY DEFINER', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(migrationSource.includes('assign_minutes_approval_delegate'), 'should create RPC');
  assert.ok(migrationSource.includes('SECURITY DEFINER'), 'RPC should be SECURITY DEFINER');
  assert.ok(migrationSource.includes("SET search_path = ''"), 'RPC should set search_path');
  assert.ok(migrationSource.includes('REVOKE EXECUTE') && migrationSource.includes('FROM PUBLIC'), 'should revoke from PUBLIC');
  assert.ok(migrationSource.includes('REVOKE EXECUTE') && migrationSource.includes('FROM anon'), 'should revoke from anon');
  assert.ok(migrationSource.includes('GRANT EXECUTE') && migrationSource.includes('TO authenticated'), 'should grant to authenticated');
});

test('migration does not fire meeting/change event for delegate operations', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  // The delegate RPC should NOT contain any reference to meeting/change event
  const delegateRpcSection = migrationSource.substring(
    migrationSource.indexOf('assign_minutes_approval_delegate'),
    migrationSource.indexOf('Revoke from PUBLIC'),
  );
  assert.ok(!delegateRpcSection.includes("'meeting'"), 'delegate RPC should not use meeting category');
  assert.ok(!delegateRpcSection.includes('meeting_change'), 'delegate RPC should not fire meeting_change');
});

test('migration approves allow both approver and delegate via OR condition', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(
    migrationSource.includes('approver_user_id = v_user_id OR delegate_user_id = v_user_id'),
    'approve_minute_revision should allow both approver and delegate',
  );
});

test('migration sets acted_by_user_id on approve and request_changes', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(migrationSource.includes('acted_by_user_id = v_user_id'), 'should set acted_by_user_id on action');
});

test('migration prevents delegation chain', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(migrationSource.includes('DELEGATE_ALREADY_ASSIGNED'), 'should reject if delegate already assigned');
});

test('migration prevents self-delegation', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(migrationSource.includes('CANNOT_DELEGATE_TO_SELF'), 'should reject self-delegation');
});

test('migration rejects delegate who is already an approver', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(migrationSource.includes('DELEGATE_ALREADY_APPROVER'), 'should reject if delegate is already approver');
});

test('migration validates delegate profile is active and non-hidden', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(migrationSource.includes('is_active = true'), 'should check is_active');
  assert.ok(migrationSource.includes('is_hidden'), 'should check is_hidden');
  assert.ok(migrationSource.includes('DELEGATE_PROFILE_INVALID'), 'should raise DELEGATE_PROFILE_INVALID');
});

test('migration validates same organization', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(migrationSource.includes('DELEGATE_DIFFERENT_ORG'), 'should check same org');
});

test('migration uses optimistic concurrency on approval updated_at', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(migrationSource.includes('APPROVAL_VERSION_CONFLICT'), 'should check optimistic concurrency');
  assert.ok(migrationSource.includes('p_expected_updated_at'), 'should accept p_expected_updated_at param');
});

test('migration RLS allows delegate to read their delegated approvals', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(
    migrationSource.includes('delegate_user_id = auth.uid()'),
    'RLS SELECT policy should include delegate_user_id check',
  );
});

test('migration event registry entries use minutes category and minute entity_type', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(migrationSource.includes("'minute_approval_delegate_assigned'"), 'should register delegate assigned event');
  assert.ok(migrationSource.includes("'minute_approver_delegate_selected'"), 'should register delegate selected event');
  assert.ok(migrationSource.includes("'minutes'"), 'should use minutes category');
  assert.ok(migrationSource.includes("'minute'"), 'should use minute entity_type');
});

test('migration templates use ON CONFLICT DO NOTHING to avoid overwriting', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(migrationSource.includes('ON CONFLICT DO NOTHING'), 'should use ON CONFLICT DO NOTHING');
});

test('migration deduplication keys include approval_id, approver, delegate, and event type', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  // The event_key for delegate assigned should include approval_id, approver, and delegate
  assert.ok(migrationSource.includes(':delegate_assigned:'), 'should have delegate_assigned event key segment');
  assert.ok(migrationSource.includes(':approver:'), 'event key should include approver');
  assert.ok(migrationSource.includes(':delegate:'), 'event key should include delegate');
  assert.ok(migrationSource.includes(':delegate_selected:'), 'should have delegate_selected event key segment');
});

test('migration excludes original approver and delegate from stakeholder notifications', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  if (!fs.existsSync(migrationsDir)) return;

  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('minutes_approval_delegate')).sort();
  if (files.length === 0) return;

  const migrationSource = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(migrationSource.includes('v_seen := ARRAY[v_user_id, p_delegate_user_id]'), 'should exclude approver and delegate from stakeholder list');
});

// ── Frontend wiring tests ─────────────────────────────────────────────────────

test('MinutesApprovalsPage queries both approver and delegate approvals', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesApprovalsPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('approver_user_id.eq.'), 'should query by approver_user_id');
  assert.ok(source.includes('delegate_user_id.eq.'), 'should query by delegate_user_id');
});

test('MinutesApprovalsPage shows delegate label for delegated approvals', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesApprovalsPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('جانشین تأییدکننده'), 'should show delegate label');
  assert.ok(source.includes('original_approver_name'), 'should show original approver name');
});

test('MinutesApprovalsPage does not expose approval-time delegate selection', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesApprovalsPage.tsx'),
    'utf-8',
  );
  assert.ok(!source.includes('assign_minutes_approval_delegate'), 'cartable must not call delegate assignment RPC');
  assert.ok(!source.includes('openDelegateModal'), 'cartable must not expose delegate selection modal');
  assert.ok(!source.includes('انتخاب جانشین تأییدکننده'), 'cartable must not render delegate selector UI');
});

test('MinutesDetailPage treats a delegate as the pending approver', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesDetailPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('a.approver_user_id === currentUserId || a.delegate_user_id === currentUserId'));
});

test('delegate cartable access migration lets delegate read the parent minute', () => {
  const migrationSource = fs.readFileSync(
    path.join(__dirname, '../../supabase/migrations/20260819180000_fix_minutes_delegate_cartable_access.sql'),
    'utf-8',
  );
  assert.ok(migrationSource.includes('private._user_can_view_minute'));
  assert.ok(migrationSource.includes('ma.delegate_user_id = auth.uid()'));
});

test('TabApprovals shows delegate, actor, and delegation time columns', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/Detail/TabApprovals.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('جانشین'), 'should show delegate column');
  assert.ok(source.includes('اقدام‌کننده'), 'should show actor column');
  assert.ok(source.includes('delegate_name'), 'should display delegate name');
  assert.ok(source.includes('acted_by_name'), 'should display actor name');
  assert.ok(source.includes('delegated_at'), 'should show delegation time');
});

test('minutesDocumentLoader fetches delegate fields from minutes_approvals', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/minutesDocumentLoader.ts'),
    'utf-8',
  );
  assert.ok(source.includes('delegate_user_id'), 'should select delegate_user_id');
  assert.ok(source.includes('delegated_by_user_id'), 'should select delegated_by_user_id');
  assert.ok(source.includes('delegated_at'), 'should select delegated_at');
  assert.ok(source.includes('acted_by_user_id'), 'should select acted_by_user_id');
});
