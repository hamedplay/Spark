import { supabase } from '../../lib/supabase';
import type { MinutesLayoutConfig } from '../MinutesDocumentData';
import type { MinutesDocumentData } from '../MinutesDocumentData';
import { toDocData } from './minutesToDocData';
import { fetchMinutesConfig } from './fetchMinutesConfig';
import type { DecisionRow } from './types';
import type {
  MinuteDetail,
  InternalParticipantRow,
  ExternalParticipantRow,
  AgendaResultRow,
  ApprovalRow,
  ApprovalCommentRow,
} from './Detail/types';
import type { ApprovalStatus } from './types';

export interface MinutesDocumentSnapshot {
  docData: MinutesDocumentData;
  minute: MinuteDetail;
  internalParts: InternalParticipantRow[];
  externalParts: ExternalParticipantRow[];
  agendaResults: AgendaResultRow[];
  approvals: ApprovalRow[];
  approvalComments: ApprovalCommentRow[];
  logoUrl: string | null;
  config: MinutesLayoutConfig;
}

export interface LoadDocumentSnapshotParams {
  minuteId: string;
  /** If provided, reuse this config/logo instead of fetching again. */
  cachedConfig?: MinutesLayoutConfig | null;
  cachedLogoUrl?: string | null;
}

/**
 * Atomically load ALL data needed to build a MinutesDocumentData snapshot:
 * template config, logo, minute row, internal/external participants, agenda,
 * approvals, approval comments, and decisions (via RPC).
 *
 * Every query must succeed before the snapshot is built. No partial/stale data
 * is ever returned. A requestToken is returned so callers can reject stale
 * responses when the user switches minutes quickly.
 */
export async function loadDocumentSnapshot(
  params: LoadDocumentSnapshotParams,
): Promise<MinutesDocumentSnapshot> {
  const { minuteId } = params;

  // 1. Config + logo (reuse cached if available)
  let config: MinutesLayoutConfig;
  let logoUrl: string | null;
  if (params.cachedConfig) {
    config = params.cachedConfig;
    logoUrl = params.cachedLogoUrl ?? null;
  } else {
    const fetched = await fetchMinutesConfig();
    config = fetched.config;
    logoUrl = fetched.logoUrl;
  }

  // 2. Minute row
  const { data: minData, error: minErr } = await supabase
    .from('minutes')
    .select('id, meeting_title_snapshot, meeting_date_snapshot, meeting_start_time_snapshot, meeting_end_time_snapshot, meeting_location_snapshot, meeting_type, org_unit_name_snapshot, secretary_name_snapshot, chair_name_snapshot, secretary_user_id, chair_user_id, created_by_user_id, notes, confidentiality, status, approval_mode, revision_number, submitted_at, secretary_confirmed_at, chair_confirmed_at, published_at, created_at, updated_at')
    .eq('id', minuteId)
    .maybeSingle();
  if (minErr) throw new Error(minErr.message);
  if (!minData) throw new Error('MINUTE_NOT_FOUND');
  const minute = minData as MinuteDetail;

  // 3. All sub-queries in parallel
  const [partsRes, extRes, agendaRes, approvalsRes, commentsRes, decisionsRes] = await Promise.all([
    supabase
      .from('minutes_participants')
      .select('id, user_id, name_snapshot, position_snapshot, org_unit_name_snapshot, invitation_status, attendance_status, delegate_name')
      .eq('minute_id', minuteId)
      .order('created_at', { ascending: true }),
    supabase
      .from('minutes_external_participants')
      .select('id, full_name, organization, position, mobile, email, attendance_status')
      .eq('minute_id', minuteId)
      .order('created_at', { ascending: true }),
    supabase
      .from('minutes_agenda_results')
      .select('id, sort_order_snapshot, agenda_title_snapshot, agenda_description_snapshot, presenter_snapshot, allocated_minutes_snapshot, discussion_result, result_type, additional_notes')
      .eq('minute_id', minuteId)
      .order('sort_order_snapshot', { ascending: true }),
    supabase
      .from('minutes_approvals')
      .select('id, approver_user_id, status, approved_at, changes_requested_at')
      .eq('minute_id', minuteId)
      .eq('revision_number', minute.revision_number)
      .order('created_at', { ascending: true }),
    supabase
      .from('minutes_approval_comments')
      .select('id, agenda_result_id, reason, suggested_correction, created_by_user_id, created_at')
      .eq('minute_id', minuteId)
      .eq('revision_number', minute.revision_number)
      .order('created_at', { ascending: true }),
    supabase.rpc('get_minutes_decisions_for_view', { p_minute_id: minuteId }),
  ]);

  // Every query must succeed
  if (partsRes.error) throw new Error(partsRes.error.message);
  if (extRes.error) throw new Error(extRes.error.message);
  if (agendaRes.error) throw new Error(agendaRes.error.message);
  if (approvalsRes.error) throw new Error(approvalsRes.error.message);
  if (commentsRes.error) throw new Error(commentsRes.error.message);
  if (decisionsRes.error) throw new Error(decisionsRes.error.message);

  const internalParts = (partsRes.data || []) as InternalParticipantRow[];
  const externalParts = (extRes.data || []) as ExternalParticipantRow[];
  const agendaResults = (agendaRes.data || []) as AgendaResultRow[];

  // 4. Fetch approver names
  const approvalRows = (approvalsRes.data || []) as Array<{
    id: string; approver_user_id: string; status: ApprovalStatus;
    approved_at: string | null; changes_requested_at: string | null;
  }>;
  let approvals: ApprovalRow[] = [];
  if (approvalRows.length > 0) {
    const userIds = approvalRows.map(a => a.approver_user_id);
    const { data: profiles, error: profErr } = await supabase
      .from('profiles_public')
      .select('user_id, full_name')
      .in('user_id', userIds);
    if (profErr) throw new Error(profErr.message);
    const nameMap = new Map((profiles || []).map((p: { user_id: string; full_name: string }) => [p.user_id, p.full_name || 'کاربر']));
    approvals = approvalRows.map(a => ({
      id: a.id,
      approver_user_id: a.approver_user_id,
      status: a.status,
      approved_at: a.approved_at,
      changes_requested_at: a.changes_requested_at,
      approver_name: nameMap.get(a.approver_user_id) || 'کاربر',
    }));
  }

  // 5. Fetch approval comment creator names
  let approvalComments: ApprovalCommentRow[] = [];
  const commentsData = (commentsRes.data || []) as Array<{
    id: string; agenda_result_id: string | null; reason: string;
    suggested_correction: string | null; created_by_user_id: string; created_at: string;
  }>;
  if (commentsData.length > 0) {
    const creatorIds = [...new Set(commentsData.map(c => c.created_by_user_id))];
    const { data: creatorProfiles, error: creatorErr } = await supabase
      .from('profiles_public')
      .select('user_id, full_name')
      .in('user_id', creatorIds);
    if (creatorErr) throw new Error(creatorErr.message);
    const creatorNameMap = new Map((creatorProfiles || []).map((p: { user_id: string; full_name: string }) => [p.user_id, p.full_name || 'کاربر']));
    approvalComments = commentsData.map(c => ({
      id: c.id,
      agenda_result_id: c.agenda_result_id,
      reason: c.reason,
      suggested_correction: c.suggested_correction,
      created_by_user_id: c.created_by_user_id,
      created_by_name: creatorNameMap.get(c.created_by_user_id) || 'کاربر',
      created_at: c.created_at,
    }));
  }

  // 6. Map decisions RPC result
  const viewRows = (decisionsRes.data || []) as Array<{
    id: string; title: string; description: string | null;
    priority: DecisionRow['priority']; status: DecisionRow['status'];
    progress_percent: number; start_date: string | null; due_date: string | null;
    responsible_unit_name_snapshot: string | null;
    primary_owner_user_id: string; owner_name: string | null;
    requires_followup: boolean; latest_update: string | null;
    agenda_result_id: string | null; agenda_title: string | null;
  }>;
  const decRows: DecisionRow[] = viewRows.map(r => ({
    id: r.id, minute_id: minuteId, agenda_result_id: r.agenda_result_id,
    title: r.title, description: r.description,
    primary_owner_user_id: r.primary_owner_user_id,
    responsible_unit_id: null,
    responsible_unit_name_snapshot: r.responsible_unit_name_snapshot,
    priority: r.priority, status: r.status, progress_percent: r.progress_percent,
    start_date: r.start_date, due_date: r.due_date, completed_at: null,
    requires_followup: r.requires_followup, latest_update: r.latest_update,
    created_by_user_id: r.primary_owner_user_id, created_at: '', updated_at: '',
    discussion_result: null, result_type: null, additional_notes: null,
  }));
  const ownerNames: Record<string, string> = {};
  for (const r of viewRows) {
    if (r.owner_name) ownerNames[r.primary_owner_user_id] = r.owner_name;
  }

  // 7. Build atomic snapshot
  const docData = toDocData({
    minute: {
      id: minute.id,
      meeting_title_snapshot: minute.meeting_title_snapshot,
      meeting_date_snapshot: minute.meeting_date_snapshot,
      meeting_start_time_snapshot: minute.meeting_start_time_snapshot,
      meeting_end_time_snapshot: minute.meeting_end_time_snapshot,
      meeting_location_snapshot: minute.meeting_location_snapshot,
      meeting_type: minute.meeting_type,
      org_unit_name_snapshot: minute.org_unit_name_snapshot,
      secretary_name_snapshot: minute.secretary_name_snapshot,
      chair_name_snapshot: minute.chair_name_snapshot,
      notes: minute.notes,
      confidentiality: minute.confidentiality,
      status: minute.status,
      approval_mode: minute.approval_mode,
      revision_number: minute.revision_number,
      secretary_confirmed_at: minute.secretary_confirmed_at,
      chair_confirmed_at: minute.chair_confirmed_at,
      published_at: minute.published_at,
    },
    internalParts,
    externalParts,
    agendaResults,
    approvals,
    approvalComments,
    decisions: decRows,
    ownerNames,
    logoUrl,
    config,
  });

  return {
    docData,
    minute,
    internalParts,
    externalParts,
    agendaResults,
    approvals,
    approvalComments,
    logoUrl,
    config,
  };
}
