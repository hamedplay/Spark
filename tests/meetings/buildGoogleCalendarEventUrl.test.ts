import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildGoogleCalendarEventUrl,
  type BuildGoogleCalendarEventUrlInput,
} from '../../src/features/meetings/builders/buildGoogleCalendarEventUrl';

function createInput(
  overrides:
    Partial<
      BuildGoogleCalendarEventUrlInput
    > = {}
): BuildGoogleCalendarEventUrlInput {
  const defaults: BuildGoogleCalendarEventUrlInput =
    {
      meeting: {
        subject: 'Design review',

        requestDate:
          '2026-08-10T08:00:00.000Z',

        duration: '60',

        representative: 'Ali',
        phone: '09120000000',

        participants: [
          'Ali',
          'Maryam',
        ],

        notes: null,
        location: 'Room A',
        guest_emails: [],
      },

      agendaItems: [],
    };

  if (overrides.meeting) {
    return {
      meeting: {
        ...defaults.meeting,
        ...overrides.meeting,
      },
      agendaItems:
        overrides.agendaItems ??
        defaults.agendaItems,
    };
  }

  return {
    meeting: defaults.meeting,
    agendaItems:
      overrides.agendaItems ??
      defaults.agendaItems,
  };
}

test('builds the legacy Google Calendar template URL', () => {
  const result = buildGoogleCalendarEventUrl(
    createInput()
  );

  const url = new URL(result);

  assert.equal(
    url.origin,
    'https://calendar.google.com'
  );
  assert.equal(
    url.pathname,
    '/calendar/render'
  );

  const params = url.searchParams;

  assert.equal(
    params.get('action'),
    'TEMPLATE'
  );
  assert.equal(
    params.get('text'),
    'Design review'
  );
  assert.equal(
    params.get('location'),
    'Room A'
  );
  assert.equal(
    params.get('ctz'),
    'Asia/Tehran'
  );
  assert.equal(
    params.get('dates'),
    '20260810T080000000Z/20260810T090000000Z'
  );
  assert.equal(
    params.get('add'),
    ''
  );
});

test('uses parseInt numeric-prefix duration behavior', () => {
  const result90 = buildGoogleCalendarEventUrl(
    createInput({
      meeting: {
        duration: '90 دقیقه',
      },
    })
  );

  const url90 = new URL(result90);
  const dates90 = url90.searchParams.get('dates');

  assert.ok(dates90);
  const [start90, end90] = dates90!.split('/');
  assert.equal(
    end90,
    '20260810T093000000Z'
  );
  assert.equal(
    start90,
    '20260810T080000000Z'
  );

  const resultFallback = buildGoogleCalendarEventUrl(
    createInput({
      meeting: {
        duration: 'not-a-number',
      },
    })
  );

  const urlFallback = new URL(resultFallback);
  const datesFallback = urlFallback.searchParams.get('dates');

  assert.ok(datesFallback);
  const [startFb, endFb] = datesFallback!.split('/');
  assert.equal(
    endFb,
    '20260810T090000000Z'
  );
  assert.equal(
    startFb,
    '20260810T080000000Z'
  );
});

test('builds Persian details in legacy order', () => {
  const result = buildGoogleCalendarEventUrl(
    createInput({
      meeting: {
        participants: ['Ali', 'Maryam'],
        notes: 'Follow-up',
      },
    })
  );

  const url = new URL(result);
  const details = url.searchParams.get('details');

  assert.equal(
    details,
    'نماینده: Ali\n' +
      'شماره تماس: 09120000000\n' +
      'شرکت‌کنندگان: Ali، Maryam\n' +
      'یادداشت‌ها: Follow-up'
  );
});

test('formats agenda rows and omits zero duration', () => {
  const result = buildGoogleCalendarEventUrl(
    createInput({
      agendaItems: [
        {
          title: 'Architecture',
          presenter: 'Sara',
          duration_minutes: 15,
        },
        {
          title: 'Decisions',
          presenter: null,
          duration_minutes: 0,
        },
      ],
    })
  );

  const url = new URL(result);
  const details = url.searchParams.get('details');

  assert.ok(details);
  const agendaIndex = details!.indexOf('دستور جلسه:');
  assert.ok(agendaIndex >= 0);

  const agendaPortion = details!.slice(agendaIndex);

  assert.equal(
    agendaPortion,
    'دستور جلسه:\n' +
      '1. Architecture | ارائه‌دهنده: Sara | 15 دقیقه\n' +
      '2. Decisions'
  );
});

test('preserves guest email ordering', () => {
  const result = buildGoogleCalendarEventUrl(
    createInput({
      meeting: {
        guest_emails: [
          'first@example.com',
          'second@example.com',
        ],
      },
    })
  );

  const url = new URL(result);
  const add = url.searchParams.get('add');

  assert.equal(
    add,
    'first@example.com,second@example.com'
  );
});

test('throws for an invalid request date', () => {
  assert.throws(() => {
    buildGoogleCalendarEventUrl(
      createInput({
        meeting: {
          requestDate: 'invalid-date',
        },
      })
    );
  });
});
