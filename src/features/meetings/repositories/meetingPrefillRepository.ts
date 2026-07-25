import { supabase } from '../../../lib/supabase';

export interface MeetingPeoplePrefill {
  participantUserIds: string[] | null;
  notifyUserIds: string[] | null;
  externalParticipants: string[] | null;
}

export async function fetchMeetingPeoplePrefill(
  meetingId: string
): Promise<MeetingPeoplePrefill | null> {
  const { data, error } = await supabase
    .from('meetings')
    .select('participant_user_ids, notify_users, external_participants')
    .eq('id', meetingId)
    .maybeSingle();
  if (error) throw error;

  if (!data) {
    return null;
  }

  return {
    participantUserIds: data.participant_user_ids ?? null,
    notifyUserIds: data.notify_users ?? null,
    externalParticipants: data.external_participants ?? null,
  };
}
