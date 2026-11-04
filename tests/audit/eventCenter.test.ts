import test from 'node:test';
import assert from 'node:assert/strict';
import { changedFields, exportEvents, isAttentionEvent, isEventCenterSchemaMissing, eventCenterErrorMessage, parseEventCenterSummary, type CenterEvent } from '../../src/components/UserGroups/eventCenterModel';

test('attention includes denied/failure independently of severity', () => {
  assert.equal(isAttentionEvent({ severity: 'info', result: 'denied' }), true);
  assert.equal(isAttentionEvent({ severity: 'warning', result: 'success' }), true);
  assert.equal(isAttentionEvent({ severity: 'info', result: null }), false);
});
test('diff preserves false and zero and detects removed fields', () => {
  assert.deepEqual(changedFields({ before_state: { is_admin: true, n: 1, removed: 'x', stable: false }, after_state: { is_admin: false, n: 0, stable: false } }), [
    { key: 'is_admin', before: true, after: false }, { key: 'n', before: 1, after: 0 }, { key: 'removed', before: 'x', after: null },
  ]);
});
test('export preserves adversarial text as JSON without HTML or spreadsheet execution', () => {
  const events = [{ event_key: 'application:a', source: 'application', category: 'users', event_type: '=HYPERLINK("bad")', metadata: { details: '<script>alert(1)</script>\nline' } }] as CenterEvent[];
  const result = JSON.parse(exportEvents(events));
  assert.equal(result.scope, 'displayed_events');
  const { event_title_fa, category_title_fa, source_title_fa, result_title_fa, details_fa, ...raw } = result.events[0];
  assert.deepEqual(raw, events[0]);
  assert.equal(source_title_fa, 'گزارش فعالیت برنامه');
  assert.equal(details_fa[0].value, events[0].metadata.details);
});

test('missing RPC has explicit guidance and is distinct from authorization/network failures', () => {
  assert.equal(isEventCenterSchemaMissing({ code: 'PGRST202' }), true);
  for (const code of ['42501', 'PGRST301', 'PGRST002', '42P01', '']) assert.equal(isEventCenterSchemaMissing({ code }), false);
  assert.match(eventCenterErrorMessage({ code: 'PGRST202' }), /کش API/);
  assert.match(eventCenterErrorMessage({ code: '42501' }), /مجوز/);
  assert.equal(isEventCenterSchemaMissing(null), false);
});

test('full-history totals are validated independently of loaded events', () => {
  assert.deepEqual(parseEventCenterSummary({ total_events: 15000, login_events: 12000, attention_events: 4, denied_events: 3, unique_actors: 22 }), {
    total_events: 15000, login_events: 12000, attention_events: 4, denied_events: 3, unique_actors: 22,
  });
  assert.equal(parseEventCenterSummary({ total_events: 1 }), null);
  assert.equal(parseEventCenterSummary({ total_events: -1, login_events: 0, attention_events: 0, denied_events: 0, unique_actors: 0 }), null);
  assert.equal(parseEventCenterSummary(null), null);
});
