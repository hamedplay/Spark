import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = readFileSync(new URL('../../src/components/CalendarMeetingForm.tsx', import.meta.url), 'utf8');
const start = source.indexOf('    if (!prefillData) return;');
const end = source.indexOf('  }, [prefillData]);', start);
const body = stripTypeScriptTypes(`function applyPrefill() {${source.slice(start, end)}}`, { mode: 'transform' });

test('similar meeting clears edit identity and series targets before participants are changed', () => {
  const state: Record<string, unknown> = {};
  const reads: string[] = [];
  const deps: Record<string, unknown> = { lastPrefillRef: { current: '' }, loadMeetingParticipants: (id: string) => reads.push(id) };
  for (const name of new Set(body.match(/\bset[A-Z]\w+/g))) deps[name] = (value: unknown) => { state[name] = value; };
  const apply = new Function('prefillData', ...Object.keys(deps), `${body}; return applyPrefill();`);
  apply({ meetingId: 'original', editAllIds: ['original', 'occurrence'], participantUserIds: ['alice', 'bob'] }, ...Object.values(deps));
  assert.equal(state.setPrefillMeetingId, 'original');
  apply({ subject: 'Similar', participantUserIds: ['alice', 'bob'] }, ...Object.values(deps));
  assert.equal(state.setPrefillMeetingId, null, 'saving must take the create branch rather than commitEdit/cancellation dispatch');
  assert.equal(state.setPrefillEditAllIds, null);
  assert.deepEqual(reads, ['original'], 'a similar draft must not reload original participants');
  assert.deepEqual(state.setSelectedParticipants, [{ id: 'alice', name: '' }, { id: 'bob', name: '' }]);
});
