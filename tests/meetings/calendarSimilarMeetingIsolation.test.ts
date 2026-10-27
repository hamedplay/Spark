import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = readFileSync(new URL('../../src/components/CalendarMeetingForm.tsx', import.meta.url), 'utf8');
const start = source.indexOf('    if (!prefillData) return;');
const end = source.indexOf('  }, [prefillData]);', start);
const body = stripTypeScriptTypes(`function applyPrefill() {${source.slice(start, end)}}`, { mode: 'transform' });

test('similar meeting clears edit identity and series targets before participants are changed', () => {
  const identitySource = source.slice(source.indexOf('  const prefillMeetingId ='), source.indexOf('  const currentEditIdRef ='));
  const identity = new Function('prefillData', `${identitySource}; return {prefillMeetingId,prefillEditAllIds};`);
  const state: Record<string, unknown> = {};
  const reads: string[] = [];
  const deps: Record<string, unknown> = { lastPrefillRef: { current: '' }, loadMeetingParticipants: (id: string) => reads.push(id) };
  for (const name of new Set(body.match(/\bset[A-Z]\w+/g))) deps[name] = (value: unknown) => { state[name] = value; };
  const apply = (prefillData:any,...values:any[]) => {const ids=identity(prefillData);return new Function('prefillData','prefillMeetingId', ...Object.keys(deps), `${body}; return applyPrefill();`)(prefillData,ids.prefillMeetingId,...values);};
  apply({ meetingId: 'original', editAllIds: ['original', 'occurrence'], participantUserIds: ['alice', 'bob'] }, ...Object.values(deps));
  assert.equal(identity({meetingId:'original'}).prefillMeetingId, 'original');
  apply({ subject: 'Similar', participantUserIds: ['alice', 'bob'] }, ...Object.values(deps));
  assert.equal(identity({mode:'create',meetingId:'original'}).prefillMeetingId, null, 'saving must take the create branch rather than commitEdit/cancellation dispatch');
  assert.equal(identity({mode:'create',meetingId:'original',editAllIds:['original']}).prefillEditAllIds, null);
  assert.deepEqual(reads, ['original'], 'a similar draft must not reload original participants');
  assert.deepEqual(state.setSelectedParticipants, [{ id: 'alice', name: '' }, { id: 'bob', name: '' }]);
});
