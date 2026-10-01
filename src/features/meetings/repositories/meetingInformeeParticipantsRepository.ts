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

export async function fetchInformeeMeetings(): Promise<InformeeMeetingOption[]> {
  const { data, error } = await supabase.rpc('get_my_informee_meetings_v1');
  if (error) throw error;

  if (!Array.isArray(data)) return [];

  return data.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.user_id !== 'string') return [];

    return [{
      id: row.id,
      subject: typeof row.subject === 'string' && row.subject.trim() ? row.subject : 'جلسه بدون عنوان',
      requestDate: typeof row.request_date === 'string' ? row.request_date : null,
      startTime: typeof row.start_time === 'string' ? row.start_time : null,
      endTime: typeof row.end_time === 'string' ? row.end_time : null,
      organizerId: row.user_id,
      participantUserIds: Array.isArray(row.participant_user_ids)
        ? row.participant_user_ids.filter((value): value is string => typeof value === 'string')
        : [],
    }];
  });
}
