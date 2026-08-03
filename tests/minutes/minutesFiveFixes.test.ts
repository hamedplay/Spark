import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Source-level contract tests ──────────────────────────────────────────────

test('migration file exists for create/update sync fix', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  assert.ok(files.length > 0, 'should find the sync fix migration');
});

test('migration does not edit previous migrations', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir).sort();
  const syncFixIdx = files.findIndex(f => f.includes('fix_create_update_minutes_draft_sync'));
  const fiveFixesIdx = files.findIndex(f => f.includes('minutes_decisions_five_fixes'));
  const runtimeFixIdx = files.findIndex(f => f.includes('fix_manage_minutes_decision_runtime'));
  assert.ok(syncFixIdx > fiveFixesIdx, 'sync fix should be after five-fixes');
  assert.ok(syncFixIdx > runtimeFixIdx, 'sync fix should be after runtime fix');
});

test('migration does not TRUNCATE or DROP TABLE', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(!sql.includes('TRUNCATE'), 'should not TRUNCATE');
  assert.ok(!sql.includes('DROP TABLE'), 'should not DROP TABLE');
});

test('migration does not add CASCADE', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(!sql.includes('ON DELETE CASCADE'), 'should not add CASCADE');
});

test('migration does not bulk DELETE external participants', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  // The old pattern was: DELETE FROM minutes_external_participants WHERE minute_id = p_minute_id
  // In the new migration, external participants are synced non-destructively
  assert.ok(
    !sql.includes('DELETE FROM public.minutes_external_participants WHERE minute_id = p_minute_id'),
    'should not bulk DELETE external participants in update_minutes_draft',
  );
});

test('migration creates 5-param update_minutes_draft (actually 6 with default)', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(
    sql.includes('p_deleted_decision_ids uuid[]') && sql.includes('p_deleted_external_participant_ids uuid[]'),
    'should have both deleted arrays in 5-param version',
  );
});

test('migration creates 4-param wrapper that calls 6-param version', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  // The 4-param wrapper should call the 6-param version with empty arrays
  assert.ok(
    sql.includes("RETURN public.update_minutes_draft(") && sql.includes("'{}'::uuid[]"),
    '4-param wrapper should call 6-param version',
  );
});

test('migration REVOKEs _sync_minutes_decisions from PUBLIC, anon, and authenticated', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(
    sql.includes('REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb, uuid[]) FROM PUBLIC'),
    'should REVOKE from PUBLIC',
  );
  assert.ok(
    sql.includes('REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb, uuid[]) FROM anon'),
    'should REVOKE from anon',
  );
  assert.ok(
    sql.includes('REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb, uuid[]) FROM authenticated'),
    'should REVOKE from authenticated',
  );
});

test('migration GRANTs create/update to authenticated only', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(
    sql.includes('GRANT EXECUTE ON FUNCTION public.create_minutes_draft(jsonb, jsonb) TO authenticated'),
    'should GRANT create to authenticated',
  );
  assert.ok(
    sql.includes('GRANT EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb, jsonb, uuid[], uuid[]) TO authenticated'),
    'should GRANT 6-param update to authenticated',
  );
  assert.ok(
    sql.includes('GRANT EXECUTE ON FUNCTION public.update_minutes_draft(uuid, timestamptz, jsonb, jsonb) TO authenticated'),
    'should GRANT 4-param update to authenticated',
  );
});

test('migration validates external_responsible_participant_id scope', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(
    sql.includes('EXTERNAL_PARTICIPANT_SCOPE_INVALID'),
    'should reject external participant from different minute',
  );
  assert.ok(
    sql.includes('EXTERNAL_PARTICIPANT_NOT_FOUND'),
    'should reject non-existent external participant',
  );
});

test('migration validates internal decision cannot have external fields', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(
    sql.includes('INTERNAL_DECISION_CANNOT_HAVE_EXTERNAL_FIELDS'),
    'should reject internal decision with external fields',
  );
  assert.ok(
    sql.includes('EXTERNAL_DECISION_CANNOT_HAVE_INTERNAL_OWNER'),
    'should reject external decision with internal owner',
  );
});

test('migration create_minutes_draft includes external participant id in INSERT', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(
    sql.includes('COALESCE(v_ep_id, gen_random_uuid())'),
    'create should use provided id or generate new one',
  );
});

test('migration update_minutes_draft does non-destructive external sync', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(
    sql.includes('UPDATE public.minutes_external_participants') && sql.includes('WHERE id = v_ep_id AND minute_id = p_minute_id'),
    'should UPDATE existing external participants by id',
  );
  assert.ok(
    sql.includes('EXTERNAL_PARTICIPANT_SCOPE_INVALID'),
    'should reject external participant from different minute',
  );
  assert.ok(
    sql.includes('FOREACH v_del_ep_id IN ARRAY'),
    'should delete only explicit external participant ids',
  );
});

test('migration syncs external participants before decisions', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_create_update_minutes_draft_sync'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  // External participants are synced in the function body before _sync_minutes_decisions call
  const extSyncPos = sql.indexOf('NON-DESTRUCTIVE sync');
  const decisionsSyncPos = sql.indexOf('Sync decisions: use 3-arg signature with explicit deleted ids');
  assert.ok(extSyncPos > 0 && decisionsSyncPos > 0, 'both syncs should exist');
  assert.ok(extSyncPos < decisionsSyncPos, 'external participants should sync before decisions');
});

test('frontend includes id in external participant payload', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesFormPage.tsx'),
    'utf-8',
  );
  assert.ok(
    source.includes('id: p.participantId'),
    'should include participantId as id in external participant payload',
  );
  assert.ok(
    !source.includes('id: p.participantId ?? p.id'),
    'should NOT fall back to temp React id for external participant payload',
  );
});

test('frontend tracks deletedExternalParticipantIds', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesFormPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('deletedExternalParticipantIds'), 'should track deleted external participant ids');
  assert.ok(
    source.includes('p_deleted_external_participant_ids'),
    'should pass deleted external participant ids to RPC',
  );
  assert.ok(
    source.includes('onRemoveExternalParticipant'),
    'should pass onRemoveExternalParticipant callback',
  );
});

test('frontend passes p_deleted_decision_ids to update RPC', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesFormPage.tsx'),
    'utf-8',
  );
  assert.ok(
    source.includes('p_deleted_decision_ids: deletedDecisionIds'),
    'should pass deleted decision ids to update RPC',
  );
});

test('SectionParticipants tracks removed external participant id', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/Form/SectionParticipants.tsx'),
    'utf-8',
  );
  assert.ok(
    source.includes('onRemoveExternalParticipant'),
    'should accept onRemoveExternalParticipant callback',
  );
  assert.ok(
    source.includes('removed?.participantId'),
    'should track participantId of removed external participant',
  );
});
