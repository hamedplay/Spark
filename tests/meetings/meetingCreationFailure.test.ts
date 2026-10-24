import assert from 'node:assert/strict';
import test from 'node:test';
import { saveNewMeetingDetails, MeetingCreationRecoveryError } from '../../src/features/meetings/services/saveNewMeetingDetails';
import { readSmsFunctionError } from '../../src/features/meetings/services/readSmsFunctionError';

test('successful details finish before notifications and never clean up', async () => {
  const calls: string[] = [];
  await saveNewMeetingDetails({
    meetingId: 'new-meeting',
    saveParticipants: async () => { calls.push('participants'); },
    saveAgenda: async () => { calls.push('agenda'); },
    rollback: async () => { calls.push('rollback'); },
  });
  calls.push('notify');
  assert.deepEqual(calls, ['participants', 'agenda', 'notify']);
});

for (const failingStep of ['participants', 'agenda']) {
  test(`${failingStep} failure cleans up and prevents notification continuation`, async () => {
    const calls: string[] = [];
    await assert.rejects(async () => {
      await saveNewMeetingDetails({
        meetingId: 'new-meeting',
        saveParticipants: async () => {
          calls.push('participants');
          if (failingStep === 'participants') throw new Error('denied');
        },
        saveAgenda: async () => { calls.push('agenda'); throw new Error('invalid agenda'); },
        rollback: async () => { calls.push('rollback'); },
      });
      calls.push('notify');
    }, /ثبت جلسه لغو شد/);
    assert.deepEqual(calls, failingStep === 'participants'
      ? ['participants', 'rollback'] : ['participants', 'agenda', 'rollback']);
  });
}

test('cleanup failure reports retained meeting identity, never claims successful rollback', async () => {
  await assert.rejects(saveNewMeetingDetails({
    meetingId: 'retained-meeting',
    saveParticipants: async () => { throw new Error('failed details'); },
    saveAgenda: async () => {},
    rollback: async () => { throw new Error('cleanup denied'); },
  }), error => error instanceof MeetingCreationRecoveryError
    && error.message.includes('retained-meeting')
    && !error.message.includes('حذف شد'));
});

test('SMS HTTP error reads structured detail and preserves original response body', async () => {
  const response = new Response(JSON.stringify({ error: 'Provider unavailable' }), { status: 503 });
  const error = Object.assign(new Error('non-2xx'), { context: response });
  assert.equal(await readSmsFunctionError(error), 'Provider unavailable');
  assert.equal(response.bodyUsed, false);
});

test('SMS supports errorCode and does not expose a non-JSON upstream page', async () => {
  const coded = Object.assign(new Error('non-2xx'), {
    context: new Response(JSON.stringify({ errorCode: 'SMS_DELIVERY_POLICY_ERROR' }), { status: 500 }),
  });
  assert.equal(await readSmsFunctionError(coded), 'SMS_DELIVERY_POLICY_ERROR');
  const html = Object.assign(new Error('non-2xx'), {
    context: new Response('<html>upstream internals</html>', { status: 502 }),
  });
  assert.equal(await readSmsFunctionError(html), 'non-2xx (HTTP 502)');
});

test('SMS network error retains its original message', async () => {
  assert.equal(await readSmsFunctionError(new Error('Network unreachable')), 'Network unreachable');
});
