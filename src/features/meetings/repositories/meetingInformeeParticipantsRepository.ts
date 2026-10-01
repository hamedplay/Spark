import { supabase } from '../../../lib/supabase';

export interface InformeeParticipantAddResult {
  added: boolean;
  participantUserId: string;
}

function parseResultRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === 'object' ? row as Record<string, unknown> : null;
}

export async function addMeetingParticipantAsInformee(
  meetingId: string,
  participantUserId: string,
): Promise<InformeeParticipantAddResult> {
  const { data, error } = await supabase.rpc('add_meeting_participant_as_informee', {
    p_meeting_id: meetingId,
    p_participant_user_id: participantUserId,
  });

  if (error) throw error;

  const row = parseResultRow(data);
  if (!row || typeof row.added !== 'boolean' || typeof row.participant_user_id !== 'string') {
    throw new Error('INVALID_ADD_PARTICIPANT_RESPONSE');
  }

  return {
    added: row.added,
    participantUserId: row.participant_user_id,
  };
}
