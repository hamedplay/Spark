import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadLatestMigrationSql(): string {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_assign_meeting_invitation_delegate'))
    .sort();
  return fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
}

function stripSqlComments(sql: string): string {
  return sql
    .split('\n')
    .filter(line => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('--') && !trimmed.startsWith('#');
    })
    .join('\n');
}

test('migration file exists for delegate fix', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_assign_meeting_invitation_delegate'))
    .sort();
  assert.ok(files.length > 0, 'should find the delegate fix migration');
});

test('migration does not edit previous migrations', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir).sort();
  const delegateFixIdx = files.findIndex(f => f.includes('fix_assign_meeting_invitation_delegate'));
  const originalDelegateIdx = files.findIndex(f => f.includes('meeting_invitation_delegate'));
  assert.ok(delegateFixIdx > originalDelegateIdx, 'fix should be after original delegate migration');
});

test('migration does not TRUNCATE or DROP TABLE', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(!sql.includes('TRUNCATE'), 'should not TRUNCATE');
  assert.ok(!sql.includes('DROP TABLE'), 'should not DROP TABLE');
});

test('migration does not add CASCADE', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(!sql.includes('ON DELETE CASCADE'), 'should not add CASCADE');
});

test('migration fixes v_next_participants to uuid[]', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(sql.includes('v_next_participants uuid[]'), 'should declare as uuid[]');
  assert.ok(!sql.includes('v_next_participants text[]'), 'should not declare as text[]');
});

test('migration replaces alias x in WHERE with qualified q.user_id', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(!sql.includes('WHERE x IS DISTINCT FROM'), 'should not use alias x in WHERE');
  assert.ok(sql.includes('q.user_id IS DISTINCT FROM v_user_id'), 'should use qualified q.user_id');
});

test('migration uses COALESCE for null array handling', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(sql.includes("COALESCE(v_meeting.participant_user_ids, '{}'::uuid[])"), 'should COALESCE null array');
});

test('migration clears delegated_at and delegated_by_user_id on ON CONFLICT', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(sql.includes('delegated_at = NULL'), 'should clear delegated_at');
  assert.ok(sql.includes('delegated_by_user_id = NULL'), 'should clear delegated_by_user_id');
  assert.ok(sql.includes('delegate_to = NULL'), 'should clear delegate_to');
  assert.ok(sql.includes("status = 'accepted'"), 'should set status to accepted');
});

test('migration adds p_metadata to all create_notification calls', () => {
  const sql = loadLatestMigrationSql();
  const notifCount = (sql.match(/public\.create_notification\(/g) || []).length;
  const metadataCount = (sql.match(/p_metadata := v_notif_metadata/g) || []).length;
  assert.ok(notifCount > 0, 'should have create_notification calls');
  assert.equal(metadataCount, notifCount, 'every create_notification should have p_metadata');
});

test('migration metadata includes all required fields', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(sql.includes("'meeting_id'"), 'metadata should have meeting_id');
  assert.ok(sql.includes("'meeting_subject'"), 'metadata should have meeting_subject');
  assert.ok(sql.includes("'meeting_date'"), 'metadata should have meeting_date');
  assert.ok(sql.includes("'start_time'"), 'metadata should have start_time');
  assert.ok(sql.includes("'end_time'"), 'metadata should have end_time');
  assert.ok(sql.includes("'location'"), 'metadata should have location');
  assert.ok(sql.includes("'represented_person_name'"), 'metadata should have represented_person_name');
  assert.ok(sql.includes("'representative_name'"), 'metadata should have representative_name');
  assert.ok(sql.includes("'organizer_name'"), 'metadata should have organizer_name');
  assert.ok(sql.includes("'meeting_link'"), 'metadata should have meeting_link');
});

test('migration has enhanced error logging with GET STACKED DIAGNOSTICS', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(sql.includes('RETURNED_SQLSTATE'), 'should log RETURNED_SQLSTATE');
  assert.ok(sql.includes('MESSAGE_TEXT'), 'should log MESSAGE_TEXT');
  assert.ok(sql.includes('PG_EXCEPTION_DETAIL'), 'should log PG_EXCEPTION_DETAIL');
  assert.ok(sql.includes('PG_EXCEPTION_HINT'), 'should log PG_EXCEPTION_HINT');
  assert.ok(sql.includes('PG_EXCEPTION_CONTEXT'), 'should log PG_EXCEPTION_CONTEXT');
  assert.ok(sql.includes('RAISE LOG'), 'should RAISE LOG');
});

test('migration error response does not expose SQL internals', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(sql.includes("'خطای داخلی در انتخاب جانشین دعوت جلسه'"), 'should have generic message');
  const othersSection = sql.substring(sql.indexOf('WHEN OTHERS THEN'));
  const returnStart = othersSection.indexOf('RETURN jsonb_build_object');
  const returnEnd = othersSection.indexOf('END;', returnStart);
  const returnBlock = othersSection.substring(returnStart, returnEnd > 0 ? returnEnd : undefined);
  assert.ok(!returnBlock.includes('v_diag_detail'), 'should not expose detail in response');
  assert.ok(!returnBlock.includes('v_diag_hint'), 'should not expose hint in response');
  assert.ok(!returnBlock.includes('v_diag_context'), 'should not expose context in response');
  assert.ok(!returnBlock.includes('v_diag_msg'), 'should not expose msg in response');
});

test('migration has no meeting/change event', () => {
  const sql = stripSqlComments(loadLatestMigrationSql());
  assert.ok(!sql.includes('meeting/change'), 'should not produce meeting/change event');
  assert.ok(!sql.includes('meeting_change'), 'should not produce meeting_change event');
});

test('migration preserves SECURITY DEFINER and search_path', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(sql.includes('SECURITY DEFINER'), 'should be SECURITY DEFINER');
  assert.ok(sql.includes("SET search_path = ''"), 'should have empty search_path');
});

test('migration has REVOKE from PUBLIC and anon, GRANT to authenticated', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.assign_meeting_invitation_delegate(uuid, uuid, timestamptz) FROM PUBLIC'), 'should REVOKE from PUBLIC');
  assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.assign_meeting_invitation_delegate(uuid, uuid, timestamptz) FROM anon'), 'should REVOKE from anon');
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.assign_meeting_invitation_delegate(uuid, uuid, timestamptz) TO authenticated'), 'should GRANT to authenticated');
});

test('migration preserves function signature', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(
    sql.includes('public.assign_meeting_invitation_delegate(') &&
    sql.includes('p_meeting_inbox_id uuid') &&
    sql.includes('p_delegate_user_id uuid') &&
    sql.includes('p_expected_updated_at timestamptz'),
    'should preserve function signature',
  );
});

test('migration does not modify minutes approval delegation', () => {
  const sql = stripSqlComments(loadLatestMigrationSql());
  assert.ok(!sql.includes('minutes_approval'), 'should not touch minutes approval');
  assert.ok(!sql.includes('approval_delegate'), 'should not touch approval delegate');
});

test('migration casts calendar_id to text in COALESCE to avoid 22P02', () => {
  const sql = stripSqlComments(loadLatestMigrationSql());
  assert.ok(
    sql.includes("COALESCE(v_meeting.calendar_id::text, '')"),
    'should cast calendar_id to text before COALESCE with empty string',
  );
  assert.ok(
    !sql.includes("COALESCE(v_meeting.calendar_id, '')"),
    'should NOT have bare COALESCE(v_meeting.calendar_id, empty string)',
  );
});

test('migration includes raw calendar_id in metadata', () => {
  const sql = loadLatestMigrationSql();
  assert.ok(
    sql.includes("'calendar_id', v_meeting.calendar_id"),
    'should include raw calendar_id uuid in metadata',
  );
});

test('migration has no other COALESCE mixing non-text with empty string', () => {
  const sql = stripSqlComments(loadLatestMigrationSql());
  assert.ok(
    !sql.includes("COALESCE(v_meeting.calendar_id, '')"),
    'should not mix uuid with empty string in COALESCE',
  );
});
