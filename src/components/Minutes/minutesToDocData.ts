import type {
  MinutesDocumentData,
  DocMinute, DocInternalPart, DocExternalPart, DocAgendaItem,
  DocDecision, DocApproval, DocApprovalComment,
  MinutesLayoutConfig,
} from './MinutesDocumentData';
import type {
  MinuteDetail, InternalParticipantRow, ExternalParticipantRow,
  AgendaResultRow, ApprovalRow, ApprovalCommentRow,
} from './Detail/types';
import type { DecisionRow } from './types';

export interface ToDocDataInput {
  minute: Pick<DocMinute, (
    'id' | 'meeting_title_snapshot' | 'meeting_date_snapshot' |
    'meeting_start_time_snapshot' | 'meeting_end_time_snapshot' |
    'meeting_location_snapshot' | 'meeting_type' |
    'org_unit_name_snapshot' | 'secretary_name_snapshot' |
    'chair_name_snapshot' | 'notes' | 'confidentiality' | 'status' |
    'approval_mode' | 'revision_number' | 'secretary_confirmed_at' |
    'chair_confirmed_at' | 'published_at'
  )>;
  internalParts: InternalParticipantRow[];
  externalParts: ExternalParticipantRow[];
  agendaResults: AgendaResultRow[];
  approvals: ApprovalRow[];
  approvalComments: ApprovalCommentRow[];
  decisions: DecisionRow[];
  ownerNames: Record<string, string>;
  logoUrl: string | null;
  config?: MinutesLayoutConfig | null;
}

export function toDocData(props: ToDocDataInput): MinutesDocumentData {
  const minute: DocMinute = {
    meeting_title_snapshot: props.minute.meeting_title_snapshot,
    meeting_date_snapshot: props.minute.meeting_date_snapshot,
    meeting_start_time_snapshot: props.minute.meeting_start_time_snapshot,
    meeting_end_time_snapshot: props.minute.meeting_end_time_snapshot,
    meeting_location_snapshot: props.minute.meeting_location_snapshot,
    meeting_type: props.minute.meeting_type,
    org_unit_name_snapshot: props.minute.org_unit_name_snapshot,
    secretary_name_snapshot: props.minute.secretary_name_snapshot,
    chair_name_snapshot: props.minute.chair_name_snapshot,
    notes: props.minute.notes,
    confidentiality: props.minute.confidentiality,
    status: props.minute.status,
    approval_mode: props.minute.approval_mode,
    revision_number: props.minute.revision_number,
    secretary_confirmed_at: props.minute.secretary_confirmed_at,
    chair_confirmed_at: props.minute.chair_confirmed_at,
    published_at: props.minute.published_at,
  };

  const internalParts: DocInternalPart[] = props.internalParts.map(p => ({
    id: p.id,
    name_snapshot: p.name_snapshot,
    position_snapshot: p.position_snapshot,
    org_unit_name_snapshot: p.org_unit_name_snapshot,
    attendance_status: p.attendance_status,
    delegate_name: null,
  }));

  const externalParts: DocExternalPart[] = props.externalParts.map(p => ({
    id: p.id,
    full_name: p.full_name,
    organization: p.organization,
    position: p.position,
    attendance_status: p.attendance_status,
  }));

  const agendaItems: DocAgendaItem[] = props.agendaResults.map((a, i) => ({
    id: a.id,
    order: a.sort_order_snapshot || i + 1,
    title: a.agenda_title_snapshot,
    description: a.agenda_description_snapshot || '',
    presenter: a.presenter_snapshot || '',
    allocatedTime: a.allocated_minutes_snapshot != null ? String(a.allocated_minutes_snapshot) : null,
  }));

  const decisions: DocDecision[] = props.decisions.map(d => ({
    id: d.id,
    title: d.title,
    description: d.description || '',
    primaryOwnerName: props.ownerNames[d.primary_owner_user_id] || '',
    responsibleUnitName: d.responsible_unit_name_snapshot,
    priority: d.priority,
    startDate: d.start_date || '',
    dueDate: d.due_date || '',
    status: d.status,
    progressPercent: d.progress_percent,
    latestUpdate: d.latest_update || '',
    discussionResult: d.discussion_result || '',
    resultType: d.result_type || '',
    additionalNotes: d.additional_notes || '',
  }));

  const approvals: DocApproval[] = props.approvals.map(a => ({
    id: a.id,
    approver_name: a.approver_name,
    status: a.status,
    approved_at: a.approved_at,
    changes_requested_at: a.changes_requested_at,
  }));

  const approvalComments: DocApprovalComment[] = props.approvalComments.map(c => ({
    id: c.id,
    agenda_result_id: c.agenda_result_id,
    reason: c.reason,
    suggested_correction: c.suggested_correction,
    created_by_name: c.created_by_name,
    created_at: c.created_at,
  }));

  const config: MinutesLayoutConfig = {
    headerTitle: props.config?.headerTitle ?? 'صورت‌جلسه',
    orgName: props.config?.orgName ?? '',
    subtitle: props.config?.subtitle ?? '',
    footerText: props.config?.footerText ?? 'پایان صورت‌جلسه',
    showLogo: props.config?.showLogo ?? true,
    showParticipants: props.config?.showParticipants ?? true,
    showApprovers: false,
    showConfidentiality: props.config?.showConfidentiality ?? true,
    showDecisions: props.config?.showDecisions ?? true,
    fontSize: props.config?.fontSize ?? 'medium',
  };

  return {
    minute,
    internalParts,
    externalParts,
    agendaItems,
    decisions,
    approvals,
    approvalComments,
    logoUrl: props.logoUrl,
    config,
  };
}

// Re-export for backward compatibility with existing import sites.
export type { MinutesDocumentData, MinutesLayoutConfig };
export type { MinuteDetail } from './Detail/types';
