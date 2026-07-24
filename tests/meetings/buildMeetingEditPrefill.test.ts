import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMeetingEditPrefill,
  type BuildMeetingEditPrefillInput,
} from '../../src/features/meetings/builders/buildMeetingEditPrefill';

function createInput(
  overrides:
    Partial<
      BuildMeetingEditPrefillInput
    > = {}
): BuildMeetingEditPrefillInput {
  const defaults: BuildMeetingEditPrefillInput =
    {
      meeting: {
        id: 'meeting-1',
        subject: 'Design review',
        location: 'Room A',
        representative: 'Ali',
        phone: '09120000000',
        notes: 'Notes',
        priority: 'medium',

        requestDate:
          '2026-03-21T12:00:00.000Z',

        request_jalaali_date:
          null,

        start_time: '09:00',
        end_time: '10:00',
      },

      override: null,
    };

  if (overrides.meeting) {
    return {
      meeting: {
        ...defaults.meeting,
        ...overrides.meeting,
      },
      override:
        overrides.override ??
        defaults.override,
    };
  }

  return {
    meeting: defaults.meeting,
    override:
      overrides.override ??
      defaults.override,
  };
}

test('returns the provided override unchanged', () => {
  const override = {
    subject: 'Override',
    location: 'Override Room',
  };

  const result = buildMeetingEditPrefill(
    createInput({ override })
  );

  assert.equal(
    result,
    override
  );
});

test('prefers the stored Jalali request date', () => {
  const result = buildMeetingEditPrefill(
    createInput({
      meeting: {
        requestDate:
          '2026-08-10T08:00:00.000Z',
        request_jalaali_date:
          '1405/05/10',
      },
    })
  );

  assert.equal(
    result.requestJalaaliDate,
    '1405/05/10'
  );
});

test('derives the Jalali request date from the Gregorian date', () => {
  const result = buildMeetingEditPrefill(
    createInput({
      meeting: {
        requestDate:
          '2026-03-21T12:00:00.000Z',
        request_jalaali_date:
          null,
      },
    })
  );

  assert.equal(
    result.requestJalaaliDate,
    '1405/01/01'
  );
});

test('uses an empty Jalali date for an invalid Gregorian date', () => {
  const result = buildMeetingEditPrefill(
    createInput({
      meeting: {
        requestDate: 'invalid-date',
        request_jalaali_date: null,
      },
    })
  );

  assert.equal(
    result.requestJalaaliDate,
    ''
  );
});

test('builds the exact legacy edit-prefill shape', () => {
  const result = buildMeetingEditPrefill(
    createInput({
      meeting: {
        notes: null,
        start_time: null,
        end_time: null,
      },
    })
  );

  assert.deepEqual(result, {
    subject: 'Design review',
    location: 'Room A',
    representative: 'Ali',
    phone: '09120000000',
    notes: '',
    priority: 'medium',
    meetingId: 'meeting-1',
    startTime: '',
    endTime: '',
    requestJalaaliDate:
      '1405/01/01',
  });
});
