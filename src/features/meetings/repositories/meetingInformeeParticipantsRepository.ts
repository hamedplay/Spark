import { supabase } from '../../../lib/supabase';

export interface InformeeParticipantAddResult {
  added: boolean;
  participantUserId: string;
}

export interface InformeeMeetingOption {
  id: string;
  subject: string;
  requestDate: string | null;
  startTime: string | null;
  endTime: string | null;
  organizerId: string;
  participantUserIds: string[];
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

export async function fetchInformeeMeetings(currentUserId: string): Promise<InformeeMeetingOption[]> {
  const { data, error } = await supabase
    .from('meetings')
    .select('id, subject, request_date, start_time, end_time, user_id, participant_user_ids')
    .contains('notify_users', [currentUserId])
    .neq('status', 'closed')
    .order('request_date', { ascending: false })
    .limit(100);

  if (error) throw error;

  return (data || []).map(row => ({
    id: row.id,
    subject: row.subject || 'جلسه بدون عنوان',
    requestDate: row.request_date || null,
    startTime: row.start_time || null,
    endTime: row.end_time || null,
    organizerId: row.user_id,
    participantUserIds: Array.isArray(row.participant_user_ids) ? row.participant_user_ids : [],
  }));
}
