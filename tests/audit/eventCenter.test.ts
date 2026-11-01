import test from 'node:test';
import assert from 'node:assert/strict';
import { changedFields, exportEvents, isAttentionEvent, isEventCenterSchemaMissing, eventCenterErrorMessage, type CenterEvent } from '../../src/components/UserGroups/eventCenterModel';

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
  const events = [{ event_key: 'application:a', event_type: '=HYPERLINK("bad")', metadata: { details: '<script>alert(1)</script>\nline' } }] as CenterEvent[];
  const result = JSON.parse(exportEvents(events));
  assert.equal(result.scope, 'displayed_events');
  assert.deepEqual(result.events, events);
});

test('missing RPC has explicit guidance and is distinct from authorization/network failures', () => {
  assert.equal(isEventCenterSchemaMissing({ code: 'PGRST202' }), true);
  for (const code of ['42501', 'PGRST301', 'PGRST002', '42P01', '']) assert.equal(isEventCenterSchemaMissing({ code }), false);
  assert.match(eventCenterErrorMessage({ code: 'PGRST202' }), /کش API/);
  assert.match(eventCenterErrorMessage({ code: '42501' }), /مجوز/);
  assert.equal(isEventCenterSchemaMissing(null), false);
});
