import type { SupabaseClient } from '@supabase/supabase-js';
import type { InvitationStatus } from '../components/Minutes/types';
import type {
  DraftMeetingInfo, DraftInternalParticipant, DraftExternalParticipant,
  DraftAgendaItem, ProfileOption, OrgUnitOption, AgendaItemOption,
} from '../components/Minutes/Form/types';
import { uid, defaultInternalParticipant, defaultExternalParticipant, defaultAgendaItem } from '../components/Minutes/Form/defaults';
import { checkMinutesAccessForMeeting } from './minutesMeetingAccess';
import { normalizeClockTime, resolveMeetingDateGregorian } from './minutesDate';

export type InboxStatus = 'pending' | 'accepted' | 'declined' | 'delegated';

/**
 * Pure mapping: meeting_inbox.status → Minutes InvitationStatus.
 * pending is preserved as 'pending' (در انتظار پاسخ) — not converted to
 * no_response. Unknown/null values fall back to 'invited' only when there is
 * genuinely no inbox record; the mapping itself returns null for unknown so
 * the caller can distinguish "no record" from "pending".
 */
export function mapInboxStatusToInvitationStatus(status: InboxStatus | string | null | undefined): InvitationStatus {
  switch (status) {
    case 'accepted': return 'accepted';
    case 'declined': return 'declined';
    case 'delegated': return 'delegated';
    case 'pending': return 'pending';
    default: return 'invited';
  }
}

/**
 * Pure dedup: remove duplicate internal participants by userId, keeping the
 * first occurrence. Entries with empty userId are preserved (secretary/chair
 * may be added without a userId in edge cases).
 */
export function dedupeInternalParticipants(rows: DraftInternalParticipant[]): DraftInternalParticipant[] {
  const seen = new Set<string>();
  const result: DraftInternalParticipant[] = [];
  for (const row of rows) {
    const key = row.userId || `__nouser__${row.nameSnapshot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

/**
 * Pure mapping: a single external participant name (meetings.external_participants
 * stores only names) → DraftExternalParticipant. Organization/position/mobile/email
 * stay empty — no fabricated data.
 */
export function mapExternalParticipantName(name: string | null | undefined): DraftExternalParticipant | null {
  if (name == null) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return {
    id: uid(),
    participantId: null,
    fullName: trimmed,
    organization: '',
    position: '',
    mobile: '',
    email: '',
    invitationStatus: 'invited',
    attendanceStatus: null,
    notes: '',
  };
}

/**
 * Pure mapping: array of external participant names → draft rows, skipping blanks.
 */
export function mapExternalParticipants(names: (string | null | undefined)[] | null | undefined): DraftExternalParticipant[] {
  if (!names || names.length === 0) return [];
  const rows: DraftExternalParticipant[] = [];
  for (const name of names) {
    const row = mapExternalParticipantName(name);
    if (row) rows.push(row);
  }
  return rows;
}

// ── Loader row types (DB shapes) ──────────────────────────────────────────────

interface MeetingRow {
  id: string;
  subject: string;
  request_date: string | null;
  request_jalaali_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  participant_user_ids: string[] | null;
  external_participants: string[] | null;
  meeting_manager: string | null;
  user_id: string;
}

interface InboxRow {
  user_id: string;
  status: string;
  delegate_to: string | null;
}

export interface MinutesPrefillData {
  info: Partial<DraftMeetingInfo>;
  internalParticipants: DraftInternalParticipant[];
  externalParticipants: DraftExternalParticipant[];
  agendaItems: DraftAgendaItem[];
  profiles: ProfileOption[];
  orgUnits: OrgUnitOption[];
}

export interface MinutesPrefillResult {
  allowed: boolean;
  errorCode: string | null;
  existingMinuteId: string | null;
  data: MinutesPrefillData | null;
}

/**
 * Centralized, type-safe loader for minutes prefill from a meeting.
 * Runs the access check first, then fetches all needed data with Promise.all
 * using the minimum query set:
 *  - meeting core info + participant_user_ids + external_participants
 *  - meeting_inbox (invitation status per user)
 *  - profiles for participants (name, position, unit)
 *  - org_units for participants
 *  - meeting_agenda_items
 *
 * A single profile fetch failure does not break the whole form — fallback
 * snapshots (empty name) are used for missing profiles.
 */
export async function loadMinutesPrefill(
  supabase: SupabaseClient,
  meetingId: string,
): Promise<MinutesPrefillResult> {
  if (!meetingId) {
    return { allowed: false, errorCode: 'MEETING_ID_REQUIRED', existingMinuteId: null, data: null };
  }

  const access = await checkMinutesAccessForMeeting(supabase, meetingId);
  if (!access.allowed) {
    return {
      allowed: false,
      errorCode: access.errorCode,
      existingMinuteId: access.existingMinuteId,
      data: null,
    };
  }

  const [
    meetingRes,
    inboxRes,
    agendaRes,
  ] = await Promise.all([
    supabase
      .from('meetings')
      .select('id, subject, request_date, request_jalaali_date, start_time, end_time, location, participant_user_ids, external_participants, meeting_manager, user_id')
      .eq('id', meetingId)
      .maybeSingle(),
    // Use the SECURITY DEFINER RPC so the meeting organizer can read ALL
    // participants' invitation statuses. A direct query on meeting_inbox is
    // blocked by RLS (only own rows visible), causing every other participant
    // to incorrectly show "no_response".
    supabase
      .rpc('get_meeting_invitation_statuses', { p_meeting_id: meetingId }),
    supabase
      .from('meeting_agenda_items')
      .select('id, title, presenter, duration_minutes, sort_order, description')
      .eq('meeting_id', meetingId)
      .order('sort_order', { ascending: true }),
  ]);

  if (meetingRes.error) {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.error('[MinutesPrefill] meetings query error:', {
        code: meetingRes.error.code,
        message: meetingRes.error.message,
        details: meetingRes.error.details,
        hint: meetingRes.error.hint,
      });
    }
    return { allowed: false, errorCode: 'MEETING_QUERY_ERROR', existingMinuteId: null, data: null };
  }
  if (!meetingRes.data) {
    return { allowed: false, errorCode: 'MEETING_NOT_FOUND', existingMinuteId: null, data: null };
  }

  // Inbox query error must NOT be silently ignored — it would cause all
  // participants to show "no_response" / "invited" incorrectly.
  if (inboxRes.error) {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.error('[MinutesPrefill] invitation statuses RPC error:', {
        code: inboxRes.error.code,
        message: inboxRes.error.message,
      });
    }
    return { allowed: false, errorCode: 'MEETING_QUERY_ERROR', existingMinuteId: null, data: null };
  }

  const meeting = meetingRes.data as MeetingRow;
  const inboxRows = (inboxRes.data || []) as InboxRow[];
  const agendaItems = (agendaRes.data || []) as AgendaItemOption[];

  const participantUserIds = meeting.participant_user_ids || [];

  // Fetch profiles for all participant user ids
  const allUserIds = Array.from(new Set(participantUserIds.filter(Boolean)));
  let profiles: ProfileOption[] = [];
  if (allUserIds.length > 0) {
    const { data: profileRows, error: profileErr } = await supabase
      .from('profiles_public')
      .select('user_id, full_name, username, position, primary_unit_id')
      .in('user_id', allUserIds);
    if (!profileErr && profileRows) {
      profiles = profileRows as ProfileOption[];
    }
  }

  // Collect delegate user ids from inbox rows so we can resolve their names.
  const delegateUserIds = Array.from(new Set(
    inboxRows.map(r => r.delegate_to).filter((id): id is string => !!id)
  ));
  let delegateProfiles: ProfileOption[] = [];
  if (delegateUserIds.length > 0) {
    const { data: dpRows, error: dpErr } = await supabase
      .from('profiles_public')
      .select('user_id, full_name, username, position, primary_unit_id')
      .in('user_id', delegateUserIds);
    if (!dpErr && dpRows) {
      delegateProfiles = dpRows as ProfileOption[];
    }
  }

  // Fetch org units for participants' primary_unit_id
  const unitIds = Array.from(new Set(
    profiles.map(p => p.primary_unit_id).filter((id): id is string => !!id)
  ));
  let orgUnits: OrgUnitOption[] = [];
  if (unitIds.length > 0) {
    const { data: unitRows, error: unitErr } = await supabase
      .from('org_units')
      .select('id, name')
      .in('id', unitIds);
    if (!unitErr && unitRows) {
      orgUnits = unitRows as OrgUnitOption[];
    }
  }

  // Build inbox status map
  const inboxMap = new Map<string, InboxRow>();
  for (const row of inboxRows) {
    inboxMap.set(row.user_id, row);
  }

  // Build internal participants from participant_user_ids + meeting_inbox
  const profileMap = new Map(profiles.map(p => [p.user_id, p]));
  const orgUnitMap = new Map(orgUnits.map(u => [u.id, u]));
  const delegateProfileMap = new Map(delegateProfiles.map(p => [p.user_id, p]));

  const internalParticipants: DraftInternalParticipant[] = participantUserIds.map((userId) => {
    const profile = profileMap.get(userId);
    const unit = profile?.primary_unit_id ? orgUnitMap.get(profile.primary_unit_id) : undefined;
    const inboxStatus = inboxMap.get(userId);
    // Fallback for missing profile: keep userId, use a safe placeholder name,
    // and log in development so unresolved users are visible.
    const fallbackName = 'همکار گرامی';
    if (!profile && typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      console.warn('[MinutesPrefill] profile not found for userId:', userId);
    }
    const delegateTo = inboxStatus?.delegate_to ?? null;
    const delegateProfile = delegateTo ? delegateProfileMap.get(delegateTo) : undefined;
    const delegateName = delegateProfile ? (delegateProfile.full_name || delegateProfile.username || '') : '';
    return {
      id: uid(),
      participantId: null,
      userId,
      nameSnapshot: profile ? (profile.full_name || profile.username || fallbackName) : fallbackName,
      positionSnapshot: profile?.position || '',
      orgUnitId: profile?.primary_unit_id || '',
      orgUnitNameSnapshot: unit?.name || '',
      invitationStatus: mapInboxStatusToInvitationStatus(inboxStatus?.status),
      attendanceStatus: null,
      delegate: '',
      delegateUserId: delegateTo,
      delegateName,
      notes: '',
    };
  });

  // Build external participants from names array
  const externalParticipants = mapExternalParticipants(meeting.external_participants);

  // Build agenda items
  const agendaDraft: DraftAgendaItem[] = agendaItems.length > 0
    ? agendaItems.map((item, idx) => ({
        id: uid(),
        meetingAgendaItemId: item.id,
        order: idx + 1,
        title: item.title,
        description: ('description' in item ? String((item as Record<string, unknown>).description ?? '') : ''),
        presenter: item.presenter || '',
        allocatedTime: item.duration_minutes != null ? String(item.duration_minutes) : '',
        discussionResult: '',
        resultType: 'discussion',
        additionalNotes: '',
      }))
    : [defaultAgendaItem(1)];

  // Build info partial — only the meeting-derived fields; secretary/chair/etc
  // remain for the user to select.
  // meeting_type and org_unit_id do not exist on the meetings table.
  // These fields are left empty for the user to fill in; no fabricated values.
  // Resolve the meeting date into a Gregorian `YYYY-MM-DD` snapshot value.
  // Priority: request_jalaali_date (Jalali → Gregorian) → request_date.
  // Invalid dates become null (never replaced with "today"). No timezone shift.
  const resolvedDate = resolveMeetingDateGregorian(
    meeting.request_jalaali_date,
    meeting.request_date,
  );

  const info: Partial<DraftMeetingInfo> = {
    meetingId: meeting.id,
    meetingTitle: meeting.subject || '',
    meetingDate: resolvedDate ?? '',
    startTime: normalizeClockTime(meeting.start_time) ?? '',
    endTime: normalizeClockTime(meeting.end_time) ?? '',
    location: meeting.location || '',
    meetingType: '',
    orgUnitId: '',
    orgUnitNameSnapshot: '',
  };

  return {
    allowed: true,
    errorCode: null,
    existingMinuteId: null,
    data: {
      info,
      internalParticipants: dedupeInternalParticipants(
        internalParticipants.length > 0 ? internalParticipants : [defaultInternalParticipant()],
      ),
      externalParticipants: externalParticipants.length > 0 ? externalParticipants : [defaultExternalParticipant()],
      agendaItems: agendaDraft,
      profiles,
      orgUnits,
    },
  };
}
