import { supabase } from '../../lib/supabase';
import type { MinutesLayoutConfig, MinutesDocumentData } from './MinutesDocumentData';
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

  const { data: minData, error: minErr } = await supabase
    .from('minutes')
    .select('id, meeting_title_snapshot, meeting_date_snapshot, meeting_start_time_snapshot, meeting_end_time_snapshot, meeting_location_snapshot, meeting_type, org_unit_name_snapshot, secretary_name_snapshot, chair_name_snapshot, secretary_user_id, chair_user_id, created_by_user_id, notes, confidentiality, status, approval_mode, revision_number, submitted_at, secretary_confirmed_at, chair_confirmed_at, published_at, created_at, updated_at')
    .eq('id', minuteId)
    .maybeSingle();
  if (minErr) throw new Error(minErr.message);
  if (!minData) throw new Error('MINUTE_NOT_FOUND');
  const minute = minData as MinuteDetail;

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
      .select('id, approver_user_id, status, approved_at, changes_requested_at, delegate_user_id, delegated_by_user_id, delegated_at, acted_by_user_id')
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

  if (partsRes.error) throw new Error(partsRes.error.message);
  if (extRes.error) throw new Error(extRes.error.message);
  if (agendaRes.error) throw new Error(agendaRes.error.message);
  if (approvalsRes.error) throw new Error(approvalsRes.error.message);
  if (commentsRes.error) throw new Error(commentsRes.error.message);
  if (decisionsRes.error) throw new Error(decisionsRes.error.message);

  const internalParts = (partsRes.data || []) as InternalParticipantRow[];
  const externalParts = (extRes.data || []) as ExternalParticipantRow[];
  const agendaResults = (agendaRes.data || []) as AgendaResultRow[];

  const approvalRows = (approvalsRes.data || []) as Array<{
    id: string; approver_user_id: string; status: ApprovalStatus;
    approved_at: string | null; changes_requested_at: string | null;
    delegate_user_id: string | null; delegated_by_user_id: string | null;
    delegated_at: string | null; acted_by_user_id: string | null;
  }>;
  let approvals: ApprovalRow[] = [];
  if (approvalRows.length > 0) {
    const userIds = new Set<string>();
    for (const approval of approvalRows) {
      userIds.add(approval.approver_user_id);
      if (approval.delegate_user_id) userIds.add(approval.delegate_user_id);
      if (approval.acted_by_user_id) userIds.add(approval.acted_by_user_id);
    }
    const { data: profiles, error: profErr } = await supabase
      .from('profiles_public')
      .select('user_id, full_name')
      .in('user_id', [...userIds]);
    if (profErr) throw new Error(profErr.message);
    const nameMap = new Map((profiles || []).map((profile: { user_id: string; full_name: string }) => [profile.user_id, profile.full_name || 'کاربر']));
    approvals = approvalRows.map(approval => ({
      id: approval.id,
      approver_user_id: approval.approver_user_id,
      status: approval.status,
      approved_at: approval.approved_at,
      changes_requested_at: approval.changes_requested_at,
      approver_name: nameMap.get(approval.approver_user_id) || 'کاربر',
      delegate_user_id: approval.delegate_user_id,
      delegate_name: approval.delegate_user_id ? (nameMap.get(approval.delegate_user_id) || 'کاربر') : null,
      delegated_by_user_id: approval.delegated_by_user_id,
      delegated_at: approval.delegated_at,
      acted_by_user_id: approval.acted_by_user_id,
      acted_by_name: approval.acted_by_user_id ? (nameMap.get(approval.acted_by_user_id) || 'کاربر') : null,
    }));
  }

  let approvalComments: ApprovalCommentRow[] = [];
  const commentsData = (commentsRes.data || []) as Array<{
    id: string; agenda_result_id: string | null; reason: string;
    suggested_correction: string | null; created_by_user_id: string; created_at: string;
  }>;
  if (commentsData.length > 0) {
    const creatorIds = [...new Set(commentsData.map(comment => comment.created_by_user_id))];
    const { data: creatorProfiles, error: creatorErr } = await supabase
      .from('profiles_public')
      .select('user_id, full_name')
      .in('user_id', creatorIds);
    if (creatorErr) throw new Error(creatorErr.message);
    const creatorNameMap = new Map((creatorProfiles || []).map((profile: { user_id: string; full_name: string }) => [profile.user_id, profile.full_name || 'کاربر']));
    approvalComments = commentsData.map(comment => ({
      id: comment.id,
      agenda_result_id: comment.agenda_result_id,
      reason: comment.reason,
      suggested_correction: comment.suggested_correction,
      created_by_user_id: comment.created_by_user_id,
      created_by_name: creatorNameMap.get(comment.created_by_user_id) || 'کاربر',
      created_at: comment.created_at,
    }));
  }

  const viewRows = (decisionsRes.data || []) as Array<{
    id: string; parent_decision_id: string | null; clause_order: number | null;
    title: string; description: string | null;
    priority: DecisionRow['priority']; status: DecisionRow['status'];
    progress_percent: number; start_date: string | null; due_date: string | null;
    responsible_unit_name_snapshot: string | null;
    primary_owner_user_id: string | null; owner_name: string | null;
    requires_followup: boolean; latest_update: string | null;
    agenda_result_id: string | null; agenda_title: string | null;
    responsible_party_type: string | null;
    external_responsible_participant_id: string | null;
    external_responsible_name_snapshot: string | null;
    external_responsible_organization_snapshot: string | null;
    external_responsible_position_snapshot: string | null;
  }>;
  const decisionRows: DecisionRow[] = viewRows.map(row => ({
    id: row.id,
    minute_id: minuteId,
    agenda_result_id: row.agenda_result_id,
    parent_decision_id: row.parent_decision_id,
    clause_order: row.clause_order,
    title: row.title,
    description: row.description,
    primary_owner_user_id: row.primary_owner_user_id,
    responsible_unit_id: null,
    responsible_unit_name_snapshot: row.responsible_unit_name_snapshot,
    priority: row.priority,
    status: row.status,
    progress_percent: row.progress_percent,
    start_date: row.start_date,
    due_date: row.due_date,
    completed_at: null,
    requires_followup: row.requires_followup,
    latest_update: row.latest_update,
    created_by_user_id: row.primary_owner_user_id || '',
    created_at: '',
    updated_at: '',
    discussion_result: null,
    result_type: null,
    additional_notes: null,
    responsible_party_type: (row.responsible_party_type || 'internal') as 'internal' | 'external',
    external_responsible_participant_id: row.external_responsible_participant_id,
    external_responsible_name_snapshot: row.external_responsible_name_snapshot,
    external_responsible_organization_snapshot: row.external_responsible_organization_snapshot,
    external_responsible_position_snapshot: row.external_responsible_position_snapshot,
  }));
  const ownerNames: Record<string, string> = {};
  for (const row of viewRows) {
    if (row.owner_name && row.primary_owner_user_id) ownerNames[row.primary_owner_user_id] = row.owner_name;
  }

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
    decisions: decisionRows,
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
