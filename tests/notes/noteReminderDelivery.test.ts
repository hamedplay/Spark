import assert from 'node:assert/strict';
import test from 'node:test';
import { processNoteReminderJobs } from '../../supabase/functions/note-reminder-worker/processJobs';

const job = (channel: string, id = channel) => ({ id, lease: 'lease', channel, owner_id: 'owner', recipient_id: 'recipient',
  message: 'عنوان\nمتن کامل یادداشت', note_title: 'عنوان', note_content: 'متن کامل یادداشت', remind_at: '2026-11-06T10:00:00Z' });
function client(recorded = true) {
  const calls: any[] = [];
  return { calls, rpc: async (name: string, body: any) => { calls.push({ name, ...body }); return { data: recorded, error: null }; } };
}
const immediate = { load: async () => ({} as any), evaluate: () => ({ sendNow: true, nextAllowedAt: null }) };

test('full note text and selected recipient are passed to both channels with stable SMS idempotency key', async () => {
  const c = client(); const sms: any[] = []; const bale: any[] = [];
  const results = await processNoteReminderJobs(c, [job('sms'), job('bale')], async body => { sms.push(body); return { data: { status: 'sent' } }; },
    async (userId, text) => { bale.push({ userId, text }); return { status: 'sent', reason: null }; }, immediate);
  assert.equal(sms[0].targetUserId, 'recipient');
  assert.equal(sms[0].context.note_content, 'متن کامل یادداشت');
  assert.equal(sms[0].eventKey, 'note-reminder:sms');
  assert.equal(bale[0].text, 'عنوان\nمتن کامل یادداشت');
  assert.ok(results.every(result => result.status === 'sent' && result.recorded));
});

test('Bale failure does not suppress SMS success for the same recipient', async () => {
  const c = client();
  const results = await processNoteReminderJobs(c, [job('sms'), job('bale')], async () => ({ data: { status: 'sent' } }),
    async () => ({ status: 'skipped', reason: 'BALE_NOT_LINKED' }), immediate);
  assert.deepEqual(results.map(r => r.status), ['sent', 'skipped']);
});

test('unknown provider outcomes stay uncertain rather than becoming automatic duplicate sends', async () => {
  const c = client();
  const results = await processNoteReminderJobs(c, [job('sms')], async () => ({ error: { status: 502 }, data: { errorCode: 'PROVIDER_TRANSPORT_ERROR' } }),
    async () => ({ status: 'sent', reason: null }), immediate);
  assert.equal(results[0].status, 'uncertain');
  assert.equal(c.calls[0].p_error, 'DELIVERY_OUTCOME_UNKNOWN');
});

test('already-confirmed SMS is successful without another provider request', async () => {
  const c = client();
  const results = await processNoteReminderJobs(c, [job('sms')], async () => ({ data: { reason: 'DUPLICATE_SMS_DISPATCH', existingStatus: 'sent' } }),
    async () => ({ status: 'sent', reason: null }), immediate);
  assert.equal(results[0].status, 'sent');
});

test('SMS timing windows postpone the job without calling a provider', async () => {
  const c = client(); let called = false;
  const at = new Date('2026-11-07T08:00:00Z');
  const results = await processNoteReminderJobs(c, [job('sms')], async () => { called = true; return {}; },
    async () => ({ status: 'sent', reason: null }), { ...immediate, evaluate: () => ({ sendNow: false, nextAllowedAt: at }) });
  assert.equal(called, false);
  assert.equal(results[0].status, 'pending');
  assert.equal(c.calls[0].p_available_at, at.toISOString());
});

test('stale leases are not reported as successfully recorded', async () => {
  const results = await processNoteReminderJobs(client(false), [job('bale')], async () => ({}),
    async () => ({ status: 'sent', reason: null }), immediate);
  assert.equal(results[0].recorded, false);
});
