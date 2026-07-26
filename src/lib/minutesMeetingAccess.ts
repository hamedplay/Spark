import type { SupabaseClient } from '@supabase/supabase-js';

export interface MinutesAccessResult {
  allowed: boolean;
  existingMinuteId: string | null;
  existingMinuteStatus: string | null;
  errorCode: string | null;
}

export interface MeetingPrefillInfo {
  meetingId: string;
  subject: string;
  requestDate: string | null;
  requestJalaaliDate: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
}

export interface MinutesAccessAndPrefillResult extends MinutesAccessResult {
  prefill: MeetingPrefillInfo | null;
}

export type MinutesEntryAction =
  | { kind: 'navigate_to_existing_minute'; minuteId: string }
  | { kind: 'navigate_to_new_form'; meetingId: string }
  | { kind: 'block'; message: string };

/**
 * Pure decision: given the access check result for a meeting, decide what the
 * "ثبت صورتجلسه" button should do. Mirrors the contract between
 * MeetingDetailModal's precheck and the minutes-new form guard.
 */
export function resolveMinutesEntryAction(
  access: MinutesAccessResult,
  meetingId: string | null,
): MinutesEntryAction {
  if (!meetingId) {
    return { kind: 'block', message: 'برای ثبت صورت‌جلسه باید از صفحه جزئیات جلسه وارد شوید.' };
  }
  if (access.errorCode === 'MINUTES_ALREADY_EXISTS' && access.existingMinuteId) {
    return { kind: 'navigate_to_existing_minute', minuteId: access.existingMinuteId };
  }
  if (access.errorCode === 'MEETING_NO_PERMISSION' || access.errorCode === 'CHECK_FAILED') {
    return { kind: 'block', message: 'جلسه موردنظر یافت نشد یا شما به آن دسترسی ندارید.' };
  }
  if (access.allowed) {
    return { kind: 'navigate_to_new_form', meetingId };
  }
  return { kind: 'block', message: 'جلسه موردنظر یافت نشد یا شما به آن دسترسی ندارید.' };
}

/**
 * Pure decision: given the `create_minutes_draft` RPC response, decide the
 * submit-flow outcome. Handles the race condition where a minutes was created
 * between the precheck and the draft creation.
 */
export type MinutesSubmitOutcome =
  | { kind: 'success'; minuteId: string }
  | { kind: 'duplicate'; minuteId: string }
  | { kind: 'error'; message: string };

export function resolveMinutesSubmitOutcome(
  rpcResult: { success: boolean; minute_id?: string; error_code?: string } | null,
  existingMinuteIdOnRace: string | null,
): MinutesSubmitOutcome {
  if (!rpcResult) {
    return { kind: 'error', message: 'ذخیره پیش‌نویس ناموفق بود.' };
  }
  if (rpcResult.success && rpcResult.minute_id) {
    return { kind: 'success', minuteId: rpcResult.minute_id };
  }
  if (rpcResult.success === false && rpcResult.error_code === 'MINUTES_ALREADY_EXISTS' && existingMinuteIdOnRace) {
    return { kind: 'duplicate', minuteId: existingMinuteIdOnRace };
  }
  return { kind: 'error', message: 'ذخیره پیش‌نویس ناموفق بود.' };
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

/**
 * Server-side validation for minutes creation.
 *
 * Uses the existing `can_create_minutes_for_meeting` RPC (auth + ownership/manager/admin
 * check, status_type='scheduled', calendar_id present) so access is enforced by the
 * database — not by the client-side meetings list, which may be incomplete due to
 * pagination/filtering. A valid-but-unauthorized UUID is indistinguishable from a
 * nonexistent UUID to the caller: both yield `MEETING_NO_PERMISSION`.
 *
 * Meeting prefill fields are read via the RLS-protected `meetings` table; if the user
 * cannot select the row, prefill is null and access falls back to the RPC result.
 */
export async function checkMinutesAccessForMeeting(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<MinutesAccessAndPrefillResult> {
  if (!meetingId) {
    return {
      allowed: false,
      existingMinuteId: null,
      existingMinuteStatus: null,
      errorCode: 'MEETING_ID_REQUIRED',
      prefill: null,
    };
  }

  const { data: canCreate, error: permErr } = await supabase.rpc('can_create_minutes_for_meeting', {
    p_meeting_id: meetingId,
  });
  if (permErr) {
    return {
      allowed: false,
      existingMinuteId: null,
      existingMinuteStatus: null,
      errorCode: 'CHECK_FAILED',
      prefill: null,
    };
  }

  const { data: existingRows, error: existErr } = await supabase
    .from('minutes')
    .select('id, status')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (existErr) {
    return {
      allowed: false,
      existingMinuteId: null,
      existingMinuteStatus: null,
      errorCode: 'CHECK_FAILED',
      prefill: null,
    };
  }

  const access = interpretMinutesAccess(canCreate as boolean | null, existingRows as Array<{ id: string; status: string }> | null);

  let prefill: MeetingPrefillInfo | null = null;
  if (access.allowed) {
    const { data: meetingRow, error: meetingErr } = await supabase
      .from('meetings')
      .select('id, subject, request_date, request_jalaali_date, start_time, end_time, location')
      .eq('id', meetingId)
      .maybeSingle();
    if (!meetingErr && meetingRow) {
      prefill = {
        meetingId: meetingRow.id,
        subject: meetingRow.subject ?? '',
        requestDate: meetingRow.request_date ?? null,
        requestJalaaliDate: meetingRow.request_jalaali_date ?? null,
        startTime: meetingRow.start_time ?? null,
        endTime: meetingRow.end_time ?? null,
        location: meetingRow.location ?? null,
      };
    }
  }

  return { ...access, prefill };
}
