import assert from 'node:assert/strict';
import test from 'node:test';
import { liveReaderHarness } from '../realtime/liveReaderHarness';

test('editing loads external informees separately alongside all other recipient roles', async () => {
  let selectedColumns = '';
  let selectedId = '';
  const harness = await liveReaderHarness([], {
    from(table: string) {
      assert.equal(table, 'meetings');
      return {
        select(columns: string) {
          selectedColumns = columns;
          return {
            eq(column: string, id: string) {
              assert.equal(column, 'id');
              selectedId = id;
              return { maybeSingle: async () => ({ data: {
                participant_user_ids: ['participant'], notify_users: ['notify'],
                external_participants: ['شرکت‌کننده'], external_informees: ['مطلع'],
              }, error: null }) };
            },
          };
        },
      };
    },
  });
  try {
    const repository = await harness.load('/src/features/meetings/repositories/meetingPrefillRepository.ts');
    assert.deepEqual(await repository.fetchMeetingPeoplePrefill('meeting-id'), {
      participantUserIds: ['participant'], notifyUserIds: ['notify'],
      externalParticipants: ['شرکت‌کننده'], externalInformees: ['مطلع'],
    });
    assert.equal(selectedId, 'meeting-id');
    assert.ok(selectedColumns.split(', ').includes('external_informees'));
  } finally {
    await harness.close();
  }
});
