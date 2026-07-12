// Shared logic: determine which meetings appear in a user's calendar.
// Used by both the Calendar UI and the daily management report edge function
// so they never diverge on what "in the user's calendar" means.

export interface CalendarMeeting {
  id: string;
  subject: string;
  request_date: string;
  start_time: string | null;
  end_time: string | null;
  duration: string;
  location: string;
  representative: string;
  phone: string;
  notes: string | null;
  priority: string;
  status: string;
  status_type: string;
  created_at: string;
  user_id: string;
  calendar_id?: string | null;
  external_participants?: string[] | null;
  participant_user_ids?: string[] | null;
  notify_users?: string[] | null;
  members_only?: boolean | null;
  meeting_manager?: string | null;
  is_online?: boolean | null;
}

export interface CalendarMeetingQuery {
  userId: string;
  startUtc: string;
  endUtc: string;
  /** Optional: calendar IDs the user is subscribed to. Meetings in these calendars are visible. */
  subscribedCalendarIds?: string[];
}

/**
 * Visibility rules (mirrors CalendarPage.tsx):
 *   Creator      → always visible (they own the meeting)
 *   Participant  → visible unless inbox status is 'pending' or 'declined'
 *   Observer     → visible unless inbox status is 'pending' or 'declined'
 *
 * Excluded statuses: pending, declined, cancelled, closed, archived (non-scheduled)
 */
export const EXCLUDED_INBOX_STATUSES = new Set(["pending", "declined"]);

/**
 * Fetch meetings that appear in a user's calendar for the given UTC time range.
 *
 * This is the single source of truth for "what meetings show in a user's calendar".
 * Both the Calendar UI and the daily report edge function must use this logic.
 *
 * Works in both browser (supabase-js client) and Deno (edge function) environments
 * by accepting a generic client with a `.from()` method.
 */
export async function getUserCalendarMeetings<TClient extends { from: (table: string) => any }>(
  client: TClient,
  params: CalendarMeetingQuery,
): Promise<CalendarMeeting[]> {
  const { userId, startUtc, endUtc, subscribedCalendarIds } = params;
  const subscribedCalIdSet = new Set(subscribedCalendarIds || []);

  // Fetch all non-closed meetings in the date range (same as CalendarPage)
  const { data: meetings, error } = await client
    .from("meetings")
    .select(
      "id,subject,request_date,start_time,end_time,duration,location,representative,phone,notes,priority,status,status_type,created_at,user_id,calendar_id,external_participants,participant_user_ids,notify_users,members_only,meeting_manager,is_online",
    )
    .neq("status", "closed")
    .gte("request_date", startUtc)
    .lte("request_date", endUtc)
    .order("start_time", { ascending: true, nullsFirst: false });

  if (error) throw new Error(`Failed to query meetings: ${error.message}`);

  // Fetch the user's meeting_inbox entries to check acceptance status
  const { data: inboxRows, error: inboxErr } = await client
    .from("meeting_inbox")
    .select("meeting_id,status")
    .eq("user_id", userId);

  if (inboxErr) throw new Error(`Failed to query meeting_inbox: ${inboxErr.message}`);

  const inboxStatus = new Map<string, string>(
    (inboxRows || []).map((r: any) => [r.meeting_id, r.status] as [string, string]),
  );

  // Apply the same visibility filter as CalendarPage
  const filtered = (meetings || []).filter((m: any) => {
    // Creator → always visible
    if (m.user_id === userId) return true;

    // Meeting in a calendar the user is subscribed to → visible
    if (m.calendar_id && subscribedCalIdSet.has(m.calendar_id)) return true;

    // Participant or observer → visible unless inbox says pending/declined
    const inboxS = inboxStatus.get(m.id);
    return !EXCLUDED_INBOX_STATUSES.has(inboxS || "pending");
  });

  return filtered as CalendarMeeting[];
}

/**
 * Batch version: fetch meetings for multiple users in fewer queries.
 * Returns a Map<userId, CalendarMeeting[]>.
 *
 * Does 1 meetings query + 1 meeting_inbox query (all users at once),
 * then groups results per user.
 */
export async function batchGetUserCalendarMeetings<TClient extends { from: (table: string) => any }>(
  client: TClient,
  userIds: string[],
  startUtc: string,
  endUtc: string,
): Promise<Map<string, CalendarMeeting[]>> {
  const result = new Map<string, CalendarMeeting[]>();
  if (userIds.length === 0) return result;

  // Fetch all non-closed meetings in the date range
  const { data: meetings, error } = await client
    .from("meetings")
    .select(
      "id,subject,request_date,start_time,end_time,duration,location,representative,phone,notes,priority,status,status_type,created_at,user_id,calendar_id,external_participants,participant_user_ids,notify_users,members_only,meeting_manager,is_online",
    )
    .neq("status", "closed")
    .gte("request_date", startUtc)
    .lte("request_date", endUtc)
    .order("start_time", { ascending: true, nullsFirst: false });

  if (error) throw new Error(`Failed to query meetings: ${error.message}`);

  // Fetch meeting_inbox for all requested users
  const { data: inboxRows, error: inboxErr } = await client
    .from("meeting_inbox")
    .select("meeting_id,user_id,status")
    .in("user_id", userIds);

  if (inboxErr) throw new Error(`Failed to query meeting_inbox: ${inboxErr.message}`);

  // Build inbox status map: Map<userId, Map<meetingId, status>>
  const inboxByUser = new Map<string, Map<string, string>>();
  for (const r of inboxRows || []) {
    let userMap = inboxByUser.get(r.user_id);
    if (!userMap) {
      userMap = new Map();
      inboxByUser.set(r.user_id, userMap);
    }
    userMap.set(r.meeting_id, r.status);
  }

  // Initialize result map for each user
  for (const uid of userIds) {
    result.set(uid, []);
  }

  // Group meetings per user using the same visibility logic
  for (const m of meetings || []) {
    for (const uid of userIds) {
      // Creator → always visible
      if (m.user_id === uid) {
        result.get(uid)!.push(m as CalendarMeeting);
        continue;
      }

      // Participant or observer → visible unless inbox says pending/declined
      const userInbox = inboxByUser.get(uid);
      const inboxS = userInbox?.get(m.id);
      if (!EXCLUDED_INBOX_STATUSES.has(inboxS || "pending")) {
        result.get(uid)!.push(m as CalendarMeeting);
      }
    }
  }

  return result;
}
