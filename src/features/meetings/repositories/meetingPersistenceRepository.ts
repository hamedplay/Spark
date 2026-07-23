import { supabase } from '../../../lib/supabase';
import type {
  MeetingPersistenceRecord,
} from '../types/meetingPersistence';

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
