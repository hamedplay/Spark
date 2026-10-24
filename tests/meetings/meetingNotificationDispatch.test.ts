import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import moment from 'moment-jalaali';
import { computeMeetingChangeSet, computeScopedMeetingChangeSet, computeExternalDiff } from '../../src/lib/meetingEditDiff';

process.env.TZ = 'Asia/Tehran';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
function evaluate(source: string, dependencies: Record<string, unknown>, result: string) {
  const javascript = stripTypeScriptTypes(source, { mode: 'transform' });
  return new Function(...Object.keys(dependencies), `${javascript}\nreturn ${result};`)(...Object.values(dependencies));
}
const before = { request_date: '2026-11-05T07:00:00.000Z', start_time: '07:00', end_time: '08:00', participant_user_ids: ['old'] };
const after = { ...before, request_date: '2026-11-04T20:30:00.000Z', participant_user_ids: ['old', 'new'] };

test('adding an attendee with the same Tehran calendar day does not change the meeting schedule', () => {
  const changes = computeMeetingChangeSet(before, after);
  assert.deepEqual(changes.importantFields, []);
  assert.equal(changes.participantChanged, true);
  assert.deepEqual(computeMeetingChangeSet(before, { ...after, request_date: '2026-11-05T20:30:00.000Z' }).importantFields, ['request_date']);
  assert.deepEqual(computeMeetingChangeSet(before, { ...before, start_time: '07:30' }).importantFields, ['start_time']);
  assert.deepEqual(computeScopedMeetingChangeSet(before, after, true).importantFields, []);
});

test('creation dispatches every audience for every actual inserted occurrence', async () => {
  const source = read('src/components/CalendarMeetingForm.tsx');
  const start = source.indexOf('      const internalSmsResults: SmsDispatchResult[] = [];', source.indexOf('let notificationMeetings'));
  const end = source.indexOf('      if (saveContact', start);
  const notifications: any[] = [];
  const sms: any[][] = [];
  const meetings = [
    { id: 'first', request_jalaali_date: '1405/08/07' },
    { id: 'second', request_jalaali_date: '1405/08/14' },
    { id: 'third', request_jalaali_date: '1405/08/21' },
  ];
  const run = evaluate(`async function run() { ${source.slice(start, end)} }`, {
    notificationMeetings: meetings, userId: 'owner', subject: 'test', senderName: 'Owner',
    smsPlaceholders: { location_part: '' }, agendaSummary: '', meetingTimeStr: '07:00-08:00',
    participantIds: ['participant'], observerIds: ['observer'], participantNameMap: {},
    sendSms: true, selectedExternal: ['External'], selectedExternalInformees: ['Informee'], contacts: [],
    getMeetingTemplateKey: () => 'meeting_created',
    insertNotification: async (payload: any) => { notifications.push(payload); return { status: 'sent' }; },
    sendSmsToExternals: async (...args: any[]) => { sms.push(args); return { ok: true, sent: 1, skipped: 0 }; },
    showSmsSummary: (internal: any[], external: any) => { assert.equal(internal.length, 6); assert.equal(external.sent, 6); },
  }, 'run');
  await run();
  assert.equal(notifications.length, 9);
  assert.equal(sms.length, 6);
  assert.equal(new Set([...notifications.map(n => n.eventKey), ...sms.map(s => s[7])]).size, 15);
  for (const meeting of meetings) {
    const events = notifications.filter(n => n.meetingId === meeting.id);
    assert.deepEqual(events.map(n => n.userId), ['owner', 'participant', 'observer']);
    assert.ok(events.every(n => n.placeholders.meeting_date === meeting.request_jalaali_date));
    const external = sms.filter(s => s[6] === meeting.id);
    assert.deepEqual(external.map(s => s[5]), ['invite', 'informee_invite']);
    assert.ok(external.every(s => s[4].meeting_date === meeting.request_jalaali_date));
  }
});

for (const importantChange of [false, true]) {
  test(`edit sends only new-member invites; retained members receive changes only on a real schedule change (${importantChange})`, async () => {
    let source = read('src/components/CalendarMeetingForm/commitEdit.ts');
    source = source.replace(/^import[\s\S]*?;\n/gm, '').replace('export async function', 'async function').replaceAll('import.meta.env?.DEV', 'false');
    const events: any[] = [];
    const external: any[][] = [];
    const rpcDiffs = ['one', 'two'].map(meeting_id => ({ meeting_id, added_participant_ids: ['new'], retained_participant_ids: ['old'], removed_participant_ids: [] }));
    const mockDb = {
      from: () => ({
        update: () => ({ in: async () => ({}), eq: async () => ({}) }),
        delete: () => ({ eq: async () => ({}) }),
        select: () => ({ in: async () => ({ data: rpcDiffs.map(d => ({ id: d.meeting_id, subject: 'test', request_date: before.request_date, start_time: '07:00', end_time: '08:00' })) }) }),
      }),
      rpc: async () => ({ data: rpcDiffs }),
    };
    const commit = evaluate(source, {
      moment, supabase: mockDb, computeExternalDiff,
      insertNotification: async (payload: any) => { events.push(payload); return { status: 'sent' }; },
      sendSmsToExternals: async (...args: any[]) => { external.push(args); return { ok: true, sent: 1, skipped: 0 }; },
      showSmsSummary: () => {}, getMeetingTemplateKey: (_role: string, event: string) => event,
      toast: { success() {}, error(message: string) { assert.fail(message); } },
    }, 'commitCalendarMeetingEdit');
    const changes = computeMeetingChangeSet(before, importantChange ? { ...after, start_time: '08:00' } : after);
    const byId = (value: any) => Object.fromEntries(rpcDiffs.map(d => [d.meeting_id, value]));
    await commit({
      snapshot: {
        operationId: 'edit', updateRecord: {}, baseFields: {}, isFirstSchedule: false,
        senderName: 'Owner', meetingDateStr: '', meetingTimeStr: '', smsPlaceholders: {}, agendaSummary: '', participantNameMap: {},
        observerIds: ['observer', 'new-observer'], gregDate: before.request_date,
        selectedParticipantIds: ['old', 'new'], selectedExternal: ['old external', 'new external'], selectedExternalInformees: ['old informee', 'new informee'], sendSms: true,
        agendaEnabled: false, agendaItems: [], isOnline: false, wasOnline: false,
        changeSetsByMeetingId: byId(changes), previousNotifyUserIdsByMeetingId: byId(['observer']),
        prevExternalByMeetingId: byId(['old external']), prevExternalInformeesByMeetingId: byId(['old informee']),
      },
      notifyExistingParticipants: true, userId: 'owner', prefillMeetingId: 'one', prefillEditAllIds: ['one', 'two'],
      subject: 'test', startTime: '07:00', endTime: '08:00', contacts: [],
      commitLockRef: { current: false }, setCommitting() {}, setEditDecision() {}, onSuccess() {},
    });
    assert.equal(events.filter(e => e.userId === 'owner').length, 0);
    for (const id of ['one', 'two']) {
      const current = events.filter(e => e.meetingId === id);
      assert.deepEqual(current.filter(e => e.eventType === 'invite').map(e => e.userId), ['new', 'new-observer']);
      assert.deepEqual(current.filter(e => e.eventType === 'change').map(e => e.userId), importantChange ? ['old', 'observer'] : []);
      const sms = external.filter(e => e[6] === id);
      assert.deepEqual(sms.filter(e => e[5].endsWith('invite')).flatMap(e => e[0]).sort(), ['new external', 'new informee']);
      assert.equal(sms.filter(e => e[5].endsWith('change')).length, importantChange ? 2 : 0);
    }
  });
}


test('repeat creation returns saved identifiers and dates used for dispatch', async () => {
  const source = read('src/components/CalendarMeetingForm/services.ts');
  const saved = [
    { id: 'saved-repeat-1', request_jalaali_date: '1405/08/14', participant_user_ids: ['participant'] },
    { id: 'saved-repeat-2', request_jalaali_date: '1405/08/21', participant_user_ids: ['participant'] },
  ];
  const create = evaluate(source.slice(source.indexOf('export async function createRepeatMeetings')).replace('export async', 'async'), {
    moment,
    toast: { success() {}, error(message: string) { assert.fail(message); } },
    supabase: { from: () => ({
      insert: () => ({ select: async (columns: string) => {
        assert.ok(columns.includes('request_jalaali_date'));
        return { data: saved };
      } }),
      upsert: async () => ({}),
    }) },
  }, 'createRepeatMeetings');
  const result = await create({
    baseRecord: { request_date: '2026-11-04T20:30:00.000Z', user_id: 'owner' },
    type: 'weekly', interval: 1, endDate: '1405/08/21', repeatWeekday: 5,
  });
  assert.deepEqual(result, saved.map(({ id, request_jalaali_date }) => ({ id, request_jalaali_date })));
});
