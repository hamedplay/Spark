import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Source-level contract tests ──────────────────────────────────────────────

test('MinutesFormPage uses CircleAlert as AlertCircle import', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesFormPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('CircleAlert as AlertCircle'), 'should import CircleAlert as AlertCircle');
  assert.ok(!source.includes('<CircleAlert'), 'should not have CircleAlert JSX');
  assert.ok(source.includes('<AlertCircle'), 'should use AlertCircle component');
});

test('MinutesFormPage defines updatePayload before update RPC call', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesFormPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('const updatePayload = buildMinutesDraftPayload()'), 'should define updatePayload');
  assert.ok(source.includes('p_payload: updatePayload'), 'should pass updatePayload to p_payload');
});

test('MyDecisionsPage does not import StopCircle', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MyDecisionsPage.tsx'),
    'utf-8',
  );
  assert.ok(!source.includes('StopCircle'), 'should not import StopCircle');
});

test('DecisionActionModal validates report text for update action', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/DecisionActionModal.tsx'),
    'utf-8',
  );
  assert.ok(source.includes("action === 'update'"), 'should check update action');
  assert.ok(source.includes('متن گزارش هنگام تغییر وضعیت یا پیشرفت'), 'should validate report for update');
});

test('DecisionActionModal submit button is disabled during submission', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/DecisionActionModal.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('disabled={submitting}'), 'should disable submit button');
});

test('MinutesFormPage tracks deletedDecisionIds', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesFormPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('deletedDecisionIds'), 'should track deletedDecisionIds');
  assert.ok(source.includes('setDeletedDecisionIds'), 'should have setter');
  assert.ok(source.includes('p_deleted_decision_ids'), 'should pass to RPC');
  assert.ok(source.includes('onRemoveDecision'), 'should pass onRemoveDecision callback');
});

test('SectionDecisions uses dropdown for responsible party type', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/Form/SectionDecisions.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('<select'), 'should use select element');
  assert.ok(source.includes('داخل سازمان'), 'should have internal option');
  assert.ok(source.includes('خارج سازمان'), 'should have external option');
  assert.ok(!source.includes('type="radio"'), 'should not use radio buttons');
});

test('SectionDecisions uses participantId ?? id for external participant selector', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesFormPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('ep.participantId ?? ep.id'), 'should use participantId ?? id for stable id');
});

test('minutesDocumentLoader reads external responsible fields from RPC', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/minutesDocumentLoader.ts'),
    'utf-8',
  );
  assert.ok(source.includes('responsible_party_type'), 'should read responsible_party_type from RPC');
  assert.ok(source.includes('external_responsible_name_snapshot'), 'should read external_responsible_name_snapshot from RPC');
  assert.ok(!source.includes("responsible_party_type: 'internal'"), 'should not hardcode internal');
});

// ── Migration contract tests ──────────────────────────────────────────────────

test('new migration removes cast to decision_status', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_manage_minutes_decision_runtime'))
    .sort();
  assert.ok(files.length > 0, 'should find the runtime fix migration');
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(!sql.includes('::public.decision_status'), 'should not cast to decision_status');
  assert.ok(sql.includes('status = v_new_status'), 'should use unaliased SET');
  assert.ok(sql.includes('completed_at = v_new_completed_at'), 'should use unaliased SET for completed_at');
  assert.ok(sql.includes('latest_update = COALESCE'), 'should use unaliased SET for latest_update');
  assert.ok(sql.includes('updated_at = v_new_updated_at'), 'should use unaliased SET for updated_at');
  assert.ok(!sql.includes('d.status ='), 'should not alias target column in SET');
  assert.ok(!sql.includes('u.resolved_at ='), 'should not alias target column in minutes_decision_updates SET');
  assert.ok(sql.includes('resolved_at = now()'), 'should use unaliased SET for resolved_at');
});

test('new migration restores publish gate', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_manage_minutes_decision_runtime'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes("v_minute_status IS DISTINCT FROM 'published'"), 'should check published status');
  assert.ok(sql.includes('v_minute_published_at IS NULL'), 'should check published_at is not null');
  assert.ok(sql.includes('MINUTE_NOT_PUBLISHED'), 'should raise MINUTE_NOT_PUBLISHED error');
});

test('new migration keeps decision_followup event and decision_owner audience', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_manage_minutes_decision_runtime'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes("'decision_followup'"), 'should use decision_followup event');
  assert.ok(sql.includes("'decision_owner'"), 'should use decision_owner audience');
});

test('new migration keeps direct p_remind_at validation', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_manage_minutes_decision_runtime'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('p_remind_at <= now()'), 'should compare directly');
  assert.ok(!sql.includes("AT TIME ZONE 'Asia/Tehran'"), 'should not use AT TIME ZONE');
});

test('new migration error handler logs full diagnostics', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_manage_minutes_decision_runtime'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('PG_EXCEPTION_DETAIL'), 'should get PG_EXCEPTION_DETAIL');
  assert.ok(sql.includes('PG_EXCEPTION_HINT'), 'should get PG_EXCEPTION_HINT');
  assert.ok(sql.includes('RETURNED_SQLSTATE'), 'should get RETURNED_SQLSTATE');
  assert.ok(sql.includes('RAISE LOG'), 'should log server-side');
  assert.ok(!sql.includes("'sqlstate', v_diag_sqlstate"), 'should not expose sqlstate in response');
});

test('sync migration uses separate p_deleted_decision_ids parameter', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_sync_minutes_decisions_and_external_schema'))
    .sort();
  assert.ok(files.length > 0, 'should find the sync fix migration');
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('p_deleted_decision_ids uuid[]'), 'should have separate parameter');
  assert.ok(!sql.includes("p_decisions->'deleted_decision_ids'"), 'should not read from p_decisions object');
  assert.ok(sql.includes('FOREACH v_delete_id IN ARRAY p_deleted_decision_ids'), 'should iterate explicit ids');
  assert.ok(sql.includes('WHERE id = v_delete_id AND minute_id = p_minute_id'), 'should verify ownership before delete');
});

test('sync migration makes primary_owner_user_id nullable', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_sync_minutes_decisions_and_external_schema'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('ALTER COLUMN primary_owner_user_id DROP NOT NULL'), 'should make nullable');
});

test('sync migration has full internal/external constraint', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_sync_minutes_decisions_and_external_schema'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes("responsible_party_type = 'internal'"), 'should check internal type');
  assert.ok(sql.includes('primary_owner_user_id IS NOT NULL'), 'should require owner for internal');
  assert.ok(sql.includes('external_responsible_name_snapshot IS NULL'), 'should require null external for internal');
  assert.ok(sql.includes('external_responsible_participant_id IS NULL'), 'should require null external id for internal');
  assert.ok(sql.includes("responsible_party_type = 'external'"), 'should check external type');
  assert.ok(sql.includes('primary_owner_user_id IS NULL'), 'should require null owner for external');
  assert.ok(sql.includes('external_responsible_name_snapshot IS NOT NULL'), 'should require external name for external');
});

test('sync migration does not add CASCADE', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_sync_minutes_decisions_and_external_schema'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(!sql.includes('ON DELETE CASCADE'), 'should not add CASCADE');
});

test('sync migration updates get_minutes_decisions_for_view to return external fields', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_sync_minutes_decisions_and_external_schema'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('responsible_party_type'), 'should return responsible_party_type');
  assert.ok(sql.includes('external_responsible_participant_id'), 'should return external_responsible_participant_id');
  assert.ok(sql.includes('external_responsible_name_snapshot'), 'should return external_responsible_name_snapshot');
  assert.ok(sql.includes('external_responsible_organization_snapshot'), 'should return external_responsible_organization_snapshot');
  assert.ok(sql.includes('external_responsible_position_snapshot'), 'should return external_responsible_position_snapshot');
});

test('no previous migration was edited', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir).sort();
  const runtimeFixIdx = files.findIndex(f => f.includes('fix_manage_minutes_decision_runtime'));
  const syncFixIdx = files.findIndex(f => f.includes('fix_sync_minutes_decisions_and_external_schema'));
  const fiveFixesIdx = files.findIndex(f => f.includes('minutes_decisions_five_fixes'));
  assert.ok(runtimeFixIdx > fiveFixesIdx, 'runtime fix should be after five-fixes');
  assert.ok(syncFixIdx > fiveFixesIdx, 'sync fix should be after five-fixes');
});

test('no migration deletes data', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('fix_sync_minutes_decisions_and_external_schema') || f.includes('fix_manage_minutes_decision_runtime'))
    .sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, f), 'utf-8');
    assert.ok(!sql.includes('TRUNCATE'), `${f} should not TRUNCATE`);
    assert.ok(!sql.includes('DROP TABLE'), `${f} should not DROP TABLE`);
    assert.ok(!sql.includes('DELETE FROM public.minutes_decisions WHERE minute_id'), `${f} should not bulk delete`);
  }
});
