import type {
  AgendaItem,
  Meeting,
} from '../../../types';

type GoogleCalendarMeeting =
  Pick<
    Meeting,
    | 'subject'
    | 'requestDate'
    | 'duration'
    | 'representative'
    | 'phone'
    | 'participants'
    | 'notes'
    | 'location'
    | 'guest_emails'
  >;

type GoogleCalendarAgendaItem =
  Pick<
    AgendaItem,
    | 'title'
    | 'presenter'
    | 'duration_minutes'
  >;

export interface BuildGoogleCalendarEventUrlInput {
  meeting: GoogleCalendarMeeting;
  agendaItems:
    GoogleCalendarAgendaItem[];
}

export function buildGoogleCalendarEventUrl(
  input:
    BuildGoogleCalendarEventUrlInput
): string {
  const startDate =
    new Date(input.meeting.requestDate);

  const durationInMinutes =
    parseInt(input.meeting.duration) ||
    60;

  const endDate = new Date(
    startDate.getTime() +
      durationInMinutes * 60000
  );

  const details = [
    `نماینده: ${
      input.meeting.representative
    }`,

    `شماره تماس: ${
      input.meeting.phone
    }`,

    `شرکت‌کنندگان: ${
      input.meeting.participants.join(
        '، '
      )
    }`,

    input.meeting.notes
      ? `یادداشت‌ها: ${
          input.meeting.notes
        }`
      : '',

    input.agendaItems.length > 0
      ? `دستور جلسه:\n` +
        input.agendaItems
          .map((item, index) => {
            const parts = [
              `${index + 1}. ${item.title}`,
            ];

            if (item.presenter) {
              parts.push(
                `ارائه‌دهنده: ${
                  item.presenter
                }`
              );
            }

            if (item.duration_minutes) {
              parts.push(
                `${
                  item.duration_minutes
                } دقیقه`
              );
            }

            return parts.join(' | ');
          })
          .join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const compactStart =
    startDate
      .toISOString()
      .replace(/(-|:|\.)/g, '');

  const compactEnd =
    endDate
      .toISOString()
      .replace(/(-|:|\.)/g, '');

  const params = new URLSearchParams({
    action: 'TEMPLATE',

    text:
      input.meeting.subject,

    details,

    location:
      input.meeting.location,

    dates:
      `${compactStart}/${compactEnd}`,

    ctz: 'Asia/Tehran',

    add:
      (
        input.meeting.guest_emails ||
        []
      ).join(','),
  });

  return (
    'https://calendar.google.com/' +
    `calendar/render?${params.toString()}`
  );
}
