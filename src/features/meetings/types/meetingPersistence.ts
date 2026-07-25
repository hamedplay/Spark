export type MeetingPersistenceStatus =
  | 'open'
  | 'closed';

export type MeetingPersistenceRepeatType =
  | 'none'
  | 'weekly'
  | 'monthly';

export interface MeetingPersistenceRecord {
  subject: string;

  request_date: string;
  request_jalaali_date: string;
  request_duration: string;
  duration: string;

  location: string;
  representative: string;
  phone: string;
  notes: string | null;

  priority: string;
  status: MeetingPersistenceStatus;
  status_type: string;
  user_id: string;

  notify_users: string[];
  participant_user_ids: string[];
  external_participants: string[];

  repeat_type: MeetingPersistenceRepeatType;
  repeat_interval: number | null;
  repeat_end_date: string | null;
  repeat_weekday: number | null;

  reminder_minutes: number | null;
  send_sms: boolean;
  meeting_manager: string | null;
  calendar_id: string | null;

  start_time?: string;
  end_time?: string;
}
