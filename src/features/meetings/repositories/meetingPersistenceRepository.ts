import { supabase } from '../../../lib/supabase';

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
  status: string;
  status_type: string;
  user_id: string;

  notify_users: string[];
  participant_user_ids: string[];
  external_participants: string[];

  repeat_type: string;
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

export async function updatePrimaryMeeting(
  meetingId: string,
  record: MeetingPersistenceRecord
): Promise<void> {
  const { error } = await supabase
    .from('meetings')
    .update(record)
    .eq('id', meetingId);
  if (error) throw error;
}

export async function createPrimaryMeeting(
  record: MeetingPersistenceRecord
): Promise<{ id: string } | null> {
  const { data, error } = await supabase
    .from('meetings')
    .insert([record])
    .select()
    .single();
  if (error) throw error;

  if (!data) {
    return null;
  }

  return { id: data.id };
}

export async function insertRecurringMeetingBatch(
  records: MeetingPersistenceRecord[]
): Promise<{ message: string } | null> {
  const { error } = await supabase
    .from('meetings')
    .insert(records);

  return error
    ? { message: error.message }
    : null;
}
