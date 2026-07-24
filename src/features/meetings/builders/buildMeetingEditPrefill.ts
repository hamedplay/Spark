import moment from 'moment-jalaali';

import type {
  Meeting,
} from '../../../types';

import type {
  MeetingFormPrefillData,
} from '../types/meetingForm';

type MeetingEditPrefillSource =
  Pick<
    Meeting,
    | 'id'
    | 'subject'
    | 'location'
    | 'representative'
    | 'phone'
    | 'notes'
    | 'priority'
    | 'requestDate'
    | 'request_jalaali_date'
    | 'start_time'
    | 'end_time'
  >;

export interface BuildMeetingEditPrefillInput {
  meeting:
    MeetingEditPrefillSource;

  override:
    MeetingFormPrefillData | null;
}

export function buildMeetingEditPrefill(
  input:
    BuildMeetingEditPrefillInput
): MeetingFormPrefillData {
  if (input.override) {
    return input.override;
  }

  let requestJalaaliDate = '';

  const storedJalaaliDate =
    input.meeting
      .request_jalaali_date;

  if (storedJalaaliDate) {
    requestJalaaliDate =
      storedJalaaliDate;
  } else if (
    input.meeting.requestDate
  ) {
    const parsedDate = moment(
      input.meeting.requestDate
    );

    if (parsedDate.isValid()) {
      requestJalaaliDate =
        `${
          parsedDate.jYear()
        }/${
          String(
            parsedDate.jMonth() + 1
          ).padStart(2, '0')
        }/${
          String(
            parsedDate.jDate()
          ).padStart(2, '0')
        }`;
    }
  }

  return {
    subject:
      input.meeting.subject,

    location:
      input.meeting.location,

    representative:
      input.meeting.representative,

    phone:
      input.meeting.phone,

    notes:
      input.meeting.notes || '',

    priority:
      input.meeting.priority,

    meetingId:
      input.meeting.id,

    startTime:
      input.meeting.start_time || '',

    endTime:
      input.meeting.end_time || '',

    requestJalaaliDate,
  };
}
