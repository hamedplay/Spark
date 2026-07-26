import type { SupabaseClient } from '@supabase/supabase-js';

export interface MinutesAccessResult {
  allowed: boolean;
  existingMinuteId: string | null;
  existingMinuteStatus: string | null;
  errorCode: string | null;
}

export function interpretMinutesAccess(
  canCreate: boolean | null,
  existingRows: Array<{ id: string; status: string }> | null,
): MinutesAccessResult {
  if (canCreate === null) {
    return { allowed: false, existingMinuteId: null, existingMinuteStatus: null, errorCode: 'CHECK_FAILED' };
  }
  if (!canCreate) {
    return { allowed: false, existingMinuteId: null, existingMinuteStatus: null, errorCode: 'MEETING_NO_PERMISSION' };
  }
  if (existingRows && existingRows.length > 0) {
    const first = existingRows[0];
    return {
      allowed: false,
      existingMinuteId: first.id,
      existingMinuteStatus: first.status,
      errorCode: 'MINUTES_ALREADY_EXISTS',
    };
  }
  return { allowed: true, existingMinuteId: null, existingMinuteStatus: null, errorCode: null };
}

export async function checkMinutesAccessForMeeting(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<MinutesAccessResult> {
  if (!meetingId) {
    return { allowed: false, existingMinuteId: null, existingMinuteStatus: null, errorCode: 'MEETING_ID_REQUIRED' };
  }
  const { data: canCreate, error: permErr } = await supabase.rpc('can_create_minutes_for_meeting', {
    p_meeting_id: meetingId,
  });
  if (permErr) {
    return { allowed: false, existingMinuteId: null, existingMinuteStatus: null, errorCode: 'CHECK_FAILED' };
  }
  const { data: existingRows, error: existErr } = await supabase
    .from('minutes')
    .select('id, status')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (existErr) {
    return { allowed: false, existingMinuteId: null, existingMinuteStatus: null, errorCode: 'CHECK_FAILED' };
  }
  return interpretMinutesAccess(canCreate as boolean | null, existingRows as Array<{ id: string; status: string }> | null);
}
