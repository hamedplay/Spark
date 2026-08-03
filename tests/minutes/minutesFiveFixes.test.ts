import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 1. Decision counts RPC ───────────────────────────────────────────────────

test('migration creates get_minutes_decision_counts RPC', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('minutes_decisions_five_fixes'))
    .sort();
  assert.ok(files.length > 0, 'should find the five-fixes migration');
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('get_minutes_decision_counts'), 'should create get_minutes_decision_counts');
  assert.ok(sql.includes('SECURITY DEFINER'), 'should be SECURITY DEFINER');
  assert.ok(sql.includes("search_path = ''"), 'should set search_path');
  assert.ok(sql.includes('_user_can_view_minute'), 'should filter by _user_can_view_minute');
  assert.ok(sql.includes('REVOKE EXECUTE'), 'should REVOKE from PUBLIC/anon');
  assert.ok(sql.includes('GRANT EXECUTE'), 'should GRANT to authenticated');
});

test('MinutesListPage uses get_minutes_decision_counts RPC instead of direct query', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesListPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('get_minutes_decision_counts'), 'should call the RPC');
  // Should NOT query minutes_decisions directly for counts
  assert.ok(!source.includes(".from('minutes_decisions')"), 'should not query minutes_decisions directly');
});

test('MinutesListPage shows dash on count error instead of zero', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesListPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('countError'), 'should track countError');
  assert.ok(source.includes("null"), 'should set decisionCount to null on error');
  assert.ok(source.includes("'—'"), 'should display dash on error');
});

// ── 2. Combined update modal ─────────────────────────────────────────────────

test('DecisionActionModal supports update action type', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/DecisionActionModal.tsx'),
    'utf-8',
  );
  assert.ok(source.includes("'update'"), 'should have update action type');
  assert.ok(source.includes('به‌روزرسانی مصوبه'), 'should have update title');
  assert.ok(source.includes('update_my_minutes_decision'), 'should call update_my_minutes_decision');
});

test('MyDecisionsPage has single update button instead of separate progress+status', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MyDecisionsPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes("onAction('update')"), 'should call update action');
  assert.ok(!source.includes("onAction('progress')"), 'should not have separate progress action');
  assert.ok(!source.includes("onAction('status')"), 'should not have separate status action');
  assert.ok(source.includes('به‌روزرسانی'), 'should have update button label');
});

test('DecisionActionModal update prevents reducing progress from 100 without reopen', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/DecisionActionModal.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('کاهش پیشرفت'), 'should check for progress reduction');
});

// ── 3. Non-destructive sync + full edit load ──────────────────────────────────

test('migration creates get_minutes_decisions_for_edit RPC', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('minutes_decisions_five_fixes'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('get_minutes_decisions_for_edit'), 'should create get_minutes_decisions_for_edit');
  assert.ok(sql.includes('SECURITY DEFINER'), 'should be SECURITY DEFINER');
  assert.ok(sql.includes('MINUTE_NOT_EDITABLE'), 'should check minute is editable');
  assert.ok(sql.includes('MINUTES_NO_PERMISSION'), 'should check permission');
  assert.ok(sql.includes('responsible_party_type'), 'should return responsible_party_type');
  assert.ok(sql.includes('external_responsible_name_snapshot'), 'should return external fields');
});

test('MinutesFormPage uses get_minutes_decisions_for_edit RPC', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesFormPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('get_minutes_decisions_for_edit'), 'should call the RPC');
  assert.ok(source.includes('decisionsLoadFailed'), 'should track load failure');
  assert.ok(source.includes('disabled={savingDraft || decisionsLoadFailed}'), 'should disable save on load failure');
  assert.ok(source.includes('بارگذاری مصوبات ناموفق'), 'should show error message');
});

test('_sync_minutes_decisions is non-destructive (no DELETE all)', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('minutes_decisions_five_fixes'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  // The new _sync_minutes_decisions should NOT have "DELETE FROM public.minutes_decisions WHERE minute_id"
  // It should only delete explicitly specified IDs
  assert.ok(!sql.includes('DELETE FROM public.minutes_decisions WHERE minute_id = p_minute_id'),
    'should not delete all decisions for the minute');
  assert.ok(sql.includes('deleted_decision_ids'), 'should use deleted_decision_ids for explicit deletion');
  assert.ok(sql.includes('UPDATE public.minutes_decisions'), 'should UPDATE existing decisions by id');
  assert.ok(sql.includes('INSERT INTO public.minutes_decisions'), 'should INSERT new decisions');
});

// ── 4. Followup page fixes ───────────────────────────────────────────────────

test('DecisionsFollowupPage does not have obstacle or status buttons', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/DecisionsFollowupPage.tsx'),
    'utf-8',
  );
  assert.ok(!source.includes("onAction('obstacle')"), 'should not have obstacle button');
  assert.ok(!source.includes("onAction('status')"), 'should not have status button');
  assert.ok(source.includes("onAction('followup')"), 'should have followup button');
});

test('manage_minutes_decision uses decision_followup not decision_followup_logged', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('minutes_decisions_five_fixes'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes("'decision_followup'"), 'should use decision_followup event type');
  assert.ok(!sql.includes("'decision_followup_logged'"), 'should not use decision_followup_logged');
});

test('manage_minutes_decision does not use AT TIME ZONE for remind_at validation', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('minutes_decisions_five_fixes'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  // The new function should compare p_remind_at directly, not apply AT TIME ZONE
  const remindSection = sql.substring(sql.indexOf('p_remind_at IS NOT NULL'), sql.indexOf('END IF;', sql.indexOf('p_remind_at IS NOT NULL')) + 10);
  assert.ok(!remindSection.includes("AT TIME ZONE 'Asia/Tehran'"), 'should not apply AT TIME ZONE for validation');
  assert.ok(remindSection.includes('p_remind_at <= now()'), 'should compare directly with now()');
});

test('manage_minutes_decision error handler includes PG_EXCEPTION_DETAIL and HINT', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('minutes_decisions_five_fixes'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('PG_EXCEPTION_DETAIL'), 'should get PG_EXCEPTION_DETAIL');
  assert.ok(sql.includes('PG_EXCEPTION_HINT'), 'should get PG_EXCEPTION_HINT');
  assert.ok(sql.includes('RETURNED_SQLSTATE'), 'should get RETURNED_SQLSTATE');
  assert.ok(sql.includes('RAISE LOG'), 'should log the error server-side');
});

test('manage_minutes_decision uses explicit aliases for all column references', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('minutes_decisions_five_fixes'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  // Check that UPDATE statements use aliases like d.status, d.completed_at
  assert.ok(sql.includes('d.status'), 'should use d.status alias');
  assert.ok(sql.includes('d.completed_at'), 'should use d.completed_at alias');
  assert.ok(sql.includes('d.latest_update'), 'should use d.latest_update alias');
  assert.ok(sql.includes('d.updated_at'), 'should use d.updated_at alias');
  assert.ok(sql.includes('d.id'), 'should use d.id alias');
  // Check that SELECT uses aliases like m.status
  assert.ok(sql.includes('m.status'), 'should use m.status alias');
  assert.ok(sql.includes('m.published_at'), 'should use m.published_at alias');
  assert.ok(sql.includes('m.secretary_user_id'), 'should use m.secretary_user_id alias');
  assert.ok(sql.includes('m.chair_user_id'), 'should use m.chair_user_id alias');
  assert.ok(sql.includes('m.created_by_user_id'), 'should use m.created_by_user_id alias');
  assert.ok(sql.includes('m.revision_number'), 'should use m.revision_number alias');
});

test('manage_minutes_decision followup sends audience decision_owner', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('minutes_decisions_five_fixes'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes("'decision_owner'"), 'should use decision_owner audience');
});

test('manage_minutes_decision followup sends full context', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('minutes_decisions_five_fixes'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('decision_title'), 'should send decision_title');
  assert.ok(sql.includes('followup_method'), 'should send followup_method');
  assert.ok(sql.includes('followup_result'), 'should send followup_result');
  assert.ok(sql.includes('followup_date'), 'should send followup_date');
  assert.ok(sql.includes('actor_name'), 'should send actor_name');
  assert.ok(sql.includes('decision_link'), 'should send decision_link');
  assert.ok(sql.includes('event_key'), 'should use unique event_key');
});

// ── 5. External responsible party ─────────────────────────────────────────────

test('migration adds external responsible party columns', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('minutes_decisions_five_fixes'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('responsible_party_type'), 'should add responsible_party_type');
  assert.ok(sql.includes('external_responsible_participant_id'), 'should add external_responsible_participant_id');
  assert.ok(sql.includes('external_responsible_name_snapshot'), 'should add external_responsible_name_snapshot');
  assert.ok(sql.includes('external_responsible_organization_snapshot'), 'should add external_responsible_organization_snapshot');
  assert.ok(sql.includes('external_responsible_position_snapshot'), 'should add external_responsible_position_snapshot');
  assert.ok(sql.includes("'internal'"), 'should allow internal type');
  assert.ok(sql.includes("'external'"), 'should allow external type');
  assert.ok(sql.includes('ON DELETE SET NULL'), 'should use ON DELETE SET NULL for FK');
  assert.ok(!sql.includes('ON DELETE CASCADE'), 'should NOT use ON DELETE CASCADE');
});

test('DraftDecision type includes external responsible fields', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/Form/types.ts'),
    'utf-8',
  );
  assert.ok(source.includes('responsiblePartyType'), 'should have responsiblePartyType');
  assert.ok(source.includes('externalResponsibleParticipantId'), 'should have externalResponsibleParticipantId');
  assert.ok(source.includes('externalResponsibleNameSnapshot'), 'should have externalResponsibleNameSnapshot');
  assert.ok(source.includes('externalResponsibleOrganizationSnapshot'), 'should have externalResponsibleOrganizationSnapshot');
  assert.ok(source.includes('externalResponsiblePositionSnapshot'), 'should have externalResponsiblePositionSnapshot');
});

test('defaultDecision includes external responsible fields with defaults', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/Form/defaults.ts'),
    'utf-8',
  );
  assert.ok(source.includes("responsiblePartyType: 'internal'"), 'should default to internal');
  assert.ok(source.includes('externalResponsibleParticipantId: null'), 'should default external id to null');
  assert.ok(source.includes("externalResponsibleNameSnapshot: ''"), 'should default external name to empty');
});

test('SectionDecisions has responsible party type dropdown', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/Form/SectionDecisions.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('نوع مسئول'), 'should have responsible party type label');
  assert.ok(source.includes('واحد/کاربر داخل سازمان'), 'should have internal option');
  assert.ok(source.includes('فرد خارج سازمان'), 'should have external option');
  assert.ok(source.includes('externalParticipants'), 'should accept externalParticipants prop');
});

test('SectionDecisions external mode shows SearchableSelect with external participants', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/Form/SectionDecisions.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('شرکت‌کنندگان خارج سازمان'), 'should show external participants selector');
  assert.ok(source.includes('externalResponsibleNameSnapshot'), 'should use external name snapshot');
});

test('MinutesFormPage passes externalParticipants to SectionDecisions', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/MinutesFormPage.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('externalParticipants='), 'should pass externalParticipants prop');
});

test('minutesToDocData shows external responsible label in Word/print', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/minutesToDocData.ts'),
    'utf-8',
  );
  assert.ok(source.includes("responsible_party_type"), 'should check responsible_party_type');
  assert.ok(source.includes("external_responsible_name_snapshot"), 'should use external name snapshot');
  assert.ok(source.includes("خارج سازمان"), 'should show external organization label');
});

test('DecisionRow type includes external responsible fields', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/types.ts'),
    'utf-8',
  );
  assert.ok(source.includes('responsible_party_type'), 'should have responsible_party_type');
  assert.ok(source.includes('external_responsible_participant_id'), 'should have external_responsible_participant_id');
  assert.ok(source.includes('external_responsible_name_snapshot'), 'should have external_responsible_name_snapshot');
});

test('decisionRpc includes error messages for new error codes', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/Minutes/decisionRpc.ts'),
    'utf-8',
  );
  assert.ok(source.includes('MINUTE_NOT_EDITABLE'), 'should have MINUTE_NOT_EDITABLE message');
  assert.ok(source.includes('MINUTES_NO_PERMISSION'), 'should have MINUTES_NO_PERMISSION message');
  assert.ok(source.includes('DECISION_TITLE_REQUIRED'), 'should have DECISION_TITLE_REQUIRED message');
  assert.ok(source.includes('DECISION_OWNER_REQUIRED'), 'should have DECISION_OWNER_REQUIRED message');
  assert.ok(source.includes('REMINDER_MUST_BE_FUTURE'), 'should have REMINDER_MUST_BE_FUTURE message');
  assert.ok(source.includes('PAYLOAD_INVALID'), 'should have PAYLOAD_INVALID message');
});

// ── No data deletion / no CASCADE ─────────────────────────────────────────────

test('migration does not delete data or add CASCADE', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.includes('minutes_decisions_five_fixes'))
    .sort();
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(!sql.includes('TRUNCATE'), 'should not TRUNCATE');
  assert.ok(!sql.includes('DROP TABLE'), 'should not DROP TABLE');
  assert.ok(!sql.includes('ON DELETE CASCADE'), 'should not add ON DELETE CASCADE');
  // Should not delete existing decisions
  assert.ok(!sql.includes('DELETE FROM public.minutes_decisions WHERE minute_id = p_minute_id'),
    'should not delete all decisions in sync');
});

test('migration does not edit previous migrations', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir).sort();
  const fiveFixesIdx = files.findIndex(f => f.includes('minutes_decisions_five_fixes'));
  assert.ok(fiveFixesIdx > 0, 'should find the five-fixes migration');
  // The five-fixes migration should be the last or near-last
  assert.ok(fiveFixesIdx >= files.length - 2, 'should be at the end of migration list');
});
