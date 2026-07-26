import { createPortal } from 'react-dom';
import type {
  MinutesDocumentData, DocAgendaItem, DocDecision,
} from './MinutesDocumentData';
import { MinutesDocumentLayout } from './MinutesDocumentLayout';
import type {
  ApprovalStatus, DecisionRow,
} from './types';

export interface PrintMinute {
  id: string;
  meeting_title_snapshot: string;
  meeting_date_snapshot: string;
  meeting_start_time_snapshot: string | null;
  meeting_end_time_snapshot: string | null;
  meeting_location_snapshot: string | null;
  meeting_type: string | null;
  org_unit_name_snapshot: string | null;
  secretary_name_snapshot: string;
  chair_name_snapshot: string;
  notes: string | null;
  confidentiality: string;
  status: string;
  approval_mode: string | null;
  revision_number: number;
  secretary_confirmed_at: string | null;
  chair_confirmed_at: string | null;
  published_at: string | null;
}

export interface PrintInternalPart {
  id: string;
  name_snapshot: string;
  position_snapshot: string | null;
  org_unit_name_snapshot: string | null;
  attendance_status: string | null;
}

export interface PrintExternalPart {
  id: string;
  full_name: string;
  organization: string | null;
  position: string | null;
  attendance_status: string | null;
}

export interface PrintAgendaResult {
  id: string;
  sort_order_snapshot: number;
  agenda_title_snapshot: string;
  agenda_description_snapshot: string | null;
  presenter_snapshot: string | null;
  allocated_minutes_snapshot: number | null;
  discussion_result: string | null;
  result_type: string;
  additional_notes: string | null;
}

export interface PrintApproval {
  id: string;
  approver_name: string;
  status: ApprovalStatus;
  approved_at: string | null;
  changes_requested_at: string | null;
}

export interface PrintApprovalComment {
  id: string;
  agenda_result_id: string | null;
  reason: string;
  suggested_correction: string | null;
  created_by_name: string;
  created_at: string;
}

export interface MinutesPrintViewProps {
  minute: PrintMinute;
  internalParts: PrintInternalPart[];
  externalParts: PrintExternalPart[];
  agendaResults: PrintAgendaResult[];
  approvals: PrintApproval[];
  approvalComments: PrintApprovalComment[];
  decisions: DecisionRow[];
  ownerNames: Record<string, string>;
  logoUrl?: string | null;
}

function toDocData(props: MinutesPrintViewProps): MinutesDocumentData {
  const agendaItems: DocAgendaItem[] = props.agendaResults.map(a => ({
    id: a.id,
    order: a.sort_order_snapshot,
    title: a.agenda_title_snapshot,
    description: a.agenda_description_snapshot || '',
    presenter: a.presenter_snapshot || '',
    allocatedTime: a.allocated_minutes_snapshot != null ? `${a.allocated_minutes_snapshot} دقیقه` : null,
  }));

  const docDecisions: DocDecision[] = props.decisions.map(d => {
    const agenda = d.agenda_result_id ? props.agendaResults.find(a => a.id === d.agenda_result_id) : null;
    return {
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
      discussionResult: d.discussion_result || agenda?.discussion_result || '',
      resultType: d.result_type || agenda?.result_type || '',
      additionalNotes: d.additional_notes || agenda?.additional_notes || '',
    };
  });

  return {
    minute: {
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
    },
    internalParts: props.internalParts.map(p => ({
      id: p.id,
      name_snapshot: p.name_snapshot,
      position_snapshot: p.position_snapshot,
      org_unit_name_snapshot: p.org_unit_name_snapshot,
    })),
    externalParts: props.externalParts.map(p => ({
      id: p.id,
      full_name: p.full_name,
      organization: p.organization,
      position: p.position,
    })),
    agendaItems,
    decisions: docDecisions,
    approvals: props.approvals.map(a => ({
      id: a.id,
      approver_name: a.approver_name,
      status: a.status,
      approved_at: a.approved_at,
      changes_requested_at: a.changes_requested_at,
    })),
    approvalComments: props.approvalComments.map(c => ({
      id: c.id,
      agenda_result_id: c.agenda_result_id,
      reason: c.reason,
      suggested_correction: c.suggested_correction,
      created_by_name: c.created_by_name,
      created_at: c.created_at,
    })),
    logoUrl: props.logoUrl || null,
  };
}

export function MinutesPrintView(props: MinutesPrintViewProps) {
  const data = toDocData(props);
  return createPortal(
    <MinutesDocumentLayout data={data} variant="print" />,
    document.body,
  );
}
