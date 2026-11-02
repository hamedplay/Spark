import test from 'node:test';
import assert from 'node:assert/strict';
import { eventTitle, categoryTitle, eventSourceTitle, eventResultTitle, fieldTitle, formatEventValue, metadataRows, eventSummary } from '../../src/components/UserGroups/eventCenterPresentation';
import { exportEvents, type CenterEvent } from '../../src/components/UserGroups/eventCenterModel';

const event = (changes: Partial<CenterEvent> = {}): CenterEvent => ({ event_key: 'application:fixture', id: 'fixture',
  created_at: '2026-11-01T12:00:00Z', source: 'application', event_type: 'logout', category: 'auth', severity: 'info',
  result: null, actor_user_id: null, actor_name: null, target_user_id: null, ip_address: null, ip_hash: null,
  session_id: null, request_id: null, error_code: null, metadata: {}, before_state: null, after_state: null, ...changes });

test('all event types in the reported sample have Persian titles and categories', () => {
  for (const type of ['logout','remove_from_personal_calendar','INFORMEE_ADD_PARTICIPANT','meeting_created','meeting_updated',
    'phone_identity_dry_run_requested','password_recovery_otp_requested','recovery_finalization_succeeded','auth.login']) {
    assert.notEqual(eventTitle(type), type);
    assert.match(eventTitle(type), /[\u0600-\u06ff]/);
  }
  assert.equal(categoryTitle('meetings'), 'جلسات');
  assert.equal(categoryTitle('unknown'), 'unknown');
});
test('nested JSON details are readable Persian fields while raw evidence is preserved', () => {
  const sample = event({ event_type: 'INFORMEE_ADD_PARTICIPANT', category: 'meetings', metadata: {
    details: JSON.stringify({ source: 'notify_user', added_by_name: 'کاربر نمونه', added_participant_name: 'همکار نمونه', added_participant_user_id: 'fixture-id' }),
  } });
  const original = JSON.stringify(sample);
  const rows = metadataRows(sample);
  assert.deepEqual(rows.find(row => row.key === 'details.source'), { key: 'details.source', label: 'منبع ثبت', value: 'مطلع جلسه' });
  assert.equal(rows.find(row => row.key === 'details.added_participant_user_id')?.value, 'fixture-id');
  assert.equal(eventSummary(sample), 'کاربر نمونه، همکار نمونه را به شرکت‌کنندگان جلسه افزود.');
  assert.equal(JSON.stringify(sample), original);
});
test('known English descriptions/enums and booleans are translated without changing arbitrary user text', () => {
  assert.equal(eventSummary(event({ metadata: { details: 'Meeting removed from the current user personal calendar only' } })), 'جلسه فقط از تقویم شخصی کاربر حذف شده است.');
  assert.equal(formatEventValue('mode', 'dry_run'), 'بررسی آزمایشی (بدون تغییر داده)');
  assert.equal(formatEventValue('is_admin', false), 'خیر');
  assert.equal(formatEventValue('attempt_count', 0), '۰');
  assert.equal(formatEventValue('details', '<script>alert(1)</script>'), '<script>alert(1)</script>');
  assert.equal(fieldTitle('unknown_key'), 'unknown_key');
});
test('authentication evidence is labelled separately; no FULL-access or browser-success inference', () => {
  const login = event({ source: 'security', event_type: 'auth.login', result: 'success', metadata: { source: 'auth_service', verification_scope: 'identity_service' } });
  assert.equal(eventSourceTitle(login), 'سرویس احراز هویت');
  assert.equal(eventResultTitle(login), 'موفق در سرویس احراز هویت');
  assert.match(formatEventValue('verification_scope', 'identity_service'), /بدون تأیید دسترسی کامل/);
  assert.equal(eventResultTitle(event()), 'نتیجه در منبع ثبت نشده');
});
test('export adds Persian descriptions and retains original event keys, timestamps and raw JSON', () => {
  const original = event({ metadata: { details: '{"source":"notify_user"}' } });
  const result = JSON.parse(exportEvents([original])).events[0];
  assert.equal(result.event_title_fa, 'خروج از سامانه');
  assert.equal(result.category_title_fa, 'ورود، خروج و احراز هویت');
  for (const [key, value] of Object.entries(original)) assert.deepEqual(result[key], value);
  assert.equal(result.details_fa[0].value, 'مطلع جلسه');
});
test('malformed JSON and prototype-looking keys remain plain safe text', () => {
  assert.equal(metadataRows(event({ metadata: { details: '{not-json' } }))[0].value, '{not-json');
  for (const key of ['__proto__', 'constructor', 'toString']) {
    assert.equal(eventTitle(key), key); assert.equal(fieldTitle(key), key);
    assert.equal(formatEventValue(key, 'value'), 'value');
  }
});
