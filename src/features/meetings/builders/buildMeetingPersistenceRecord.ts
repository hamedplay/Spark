import type {
  MeetingPersistenceRecord,
  MeetingPersistenceRepeatType,
} from '../types/meetingPersistence';

type EnabledRepeatType =
  Exclude<MeetingPersistenceRepeatType, 'none'>;

export interface BuildMeetingPersistenceRecordInput {
  subject: string;

  gregorianRequestDate: string;
  requestJalaaliDate: string;
  requestDuration: string;

  location: string;
  representative: string;
  phone: string;
  notes: string;

  priority: string;
  statusType: string;
  userId: string;

  notifyUserIds: string[];
  participantUserIds: string[];
  externalParticipants: string[];

  repeatEnabled: boolean;
  repeatType: EnabledRepeatType;
  repeatInterval: number;
  repeatEndDate: string;
  repeatWeekday: number;

  reminderMinutes: number;
  meetingManager: string;
  calendarId: string;

  isSchedulingFromCalendar: boolean;
  startTime: string;
  endTime: string;
}

export function buildMeetingPersistenceRecord(
  input: BuildMeetingPersistenceRecordInput
): MeetingPersistenceRecord {
  const record: MeetingPersistenceRecord = {
    subject: input.subject,

    request_date: input.gregorianRequestDate,
    request_jalaali_date: input.requestJalaaliDate,

    request_duration: input.requestDuration,

    duration:
      input.isSchedulingFromCalendar &&
      input.startTime &&
      input.endTime
        ? `${input.startTime} - ${input.endTime}`
        : input.requestDuration,

    location: input.location,
    representative: input.representative,
    phone: input.phone,
    notes: input.notes || null,

    priority: input.priority,

    status:
      input.isSchedulingFromCalendar
        ? 'closed'
        : 'open',

    status_type: input.statusType,
    user_id: input.userId,

    notify_users: Array.from(
      new Set([
        input.userId,
        ...input.notifyUserIds,
      ])
    ),

    participant_user_ids: input.participantUserIds,

    external_participants: input.externalParticipants,

    repeat_type:
      input.repeatEnabled
        ? input.repeatType
        : 'none',

    repeat_interval:
      input.repeatEnabled
        ? input.repeatInterval
        : null,

    repeat_end_date:
      input.repeatEnabled
        ? input.repeatEndDate
        : null,

    repeat_weekday:
      input.repeatEnabled &&
      input.repeatType === 'weekly'
        ? input.repeatWeekday
        : null,

    reminder_minutes: input.reminderMinutes || null,

    send_sms: false,

    meeting_manager: input.meetingManager || null,

    calendar_id: input.calendarId || null,
  };

  if (input.startTime && input.endTime) {
    record.start_time = input.startTime;
    record.end_time = input.endTime;
  }

  return record;
}
