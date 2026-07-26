import type { SupabaseClient } from '@supabase/supabase-js';
import type { InvitationStatus } from '../components/Minutes/types';
import type {
  DraftMeetingInfo, DraftInternalParticipant, DraftExternalParticipant,
  DraftAgendaItem, ProfileOption, OrgUnitOption, AgendaItemOption,
} from '../components/Minutes/Form/types';
import { uid, defaultInternalParticipant, defaultExternalParticipant, defaultAgendaItem } from '../components/Minutes/Form/defaults';
import { checkMinutesAccessForMeeting } from './minutesMeetingAccess';

export type InboxStatus = 'pending' | 'accepted' | 'declined' | 'delegated';

/**
 * Pure mapping: meeting_inbox.status → Minutes InvitationStatus.
 * pending → no_response (وضعیت انتظار در قرارداد Minutes)
 */
export function mapInboxStatusToInvitationStatus(status: InboxStatus | string | null | undefined): InvitationStatus {
  switch (status) {
    case 'accepted': return 'accepted';
    case 'declined': return 'declined';
    case 'delegated': return 'delegated';
    case 'pending': return 'no_response';
    default: return 'no_response';
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
    fullName: trimmed,
    organization: '',
    position: '',
    mobile: '',
    email: '',
    attendanceStatus: null,
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
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  meeting_type: string | null;
  org_unit_id: string | null;
  participant_user_ids: string[] | null;
  external_participants: string[] | null;
  meeting_manager: string | null;
  user_id: string;
}

interface InboxRow {
  user_id: string;
  status: string;
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
      .select('id, subject, request_date, start_time, end_time, location, meeting_type, org_unit_id, participant_user_ids, external_participants, meeting_manager, user_id')
      .eq('id', meetingId)
      .maybeSingle(),
    supabase
      .from('meeting_inbox')
      .select('user_id, status')
      .eq('meeting_id', meetingId),
    supabase
      .from('meeting_agenda_items')
      .select('id, title, presenter, duration_minutes, sort_order, description')
      .eq('meeting_id', meetingId)
      .order('sort_order', { ascending: true }),
  ]);

  if (meetingRes.error || !meetingRes.data) {
    return { allowed: false, errorCode: 'CHECK_FAILED', existingMinuteId: null, data: null };
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
      .from('profiles')
      .select('user_id, full_name, email, position, primary_unit_id')
      .in('user_id', allUserIds);
    if (!profileErr && profileRows) {
      profiles = profileRows as ProfileOption[];
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
  const inboxMap = new Map<string, InboxStatus>();
  for (const row of inboxRows) {
    inboxMap.set(row.user_id, row.status as InboxStatus);
  }

  // Build internal participants from participant_user_ids + meeting_inbox
  const profileMap = new Map(profiles.map(p => [p.user_id, p]));
  const orgUnitMap = new Map(orgUnits.map(u => [u.id, u]));

  const internalParticipants: DraftInternalParticipant[] = participantUserIds.map((userId) => {
    const profile = profileMap.get(userId);
    const unit = profile?.primary_unit_id ? orgUnitMap.get(profile.primary_unit_id) : undefined;
    const inboxStatus = inboxMap.get(userId);
    return {
      id: uid(),
      userId,
      nameSnapshot: profile ? (profile.full_name || profile.email || '') : '',
      positionSnapshot: profile?.position || '',
      orgUnitId: profile?.primary_unit_id || '',
      orgUnitNameSnapshot: unit?.name || '',
      invitationStatus: mapInboxStatusToInvitationStatus(inboxStatus),
      attendanceStatus: null,
      delegate: '',
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
  const info: Partial<DraftMeetingInfo> = {
    meetingId: meeting.id,
    meetingTitle: meeting.subject || '',
    meetingDate: meeting.request_date || '',
    startTime: meeting.start_time || '',
    endTime: meeting.end_time || '',
    location: meeting.location || '',
    meetingType: meeting.meeting_type || '',
    orgUnitId: meeting.org_unit_id || '',
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
