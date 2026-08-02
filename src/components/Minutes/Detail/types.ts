import type { ApprovalStatus } from '../types';

export interface MinuteDetail {
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
  secretary_user_id: string | null;
  chair_user_id: string | null;
  created_by_user_id: string;
  notes: string | null;
  confidentiality: string;
  status: string;
  approval_mode: string | null;
  revision_number: number;
  submitted_at: string | null;
  secretary_confirmed_at: string | null;
  chair_confirmed_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InternalParticipantRow {
  id: string;
  user_id: string | null;
  name_snapshot: string;
  position_snapshot: string | null;
  org_unit_name_snapshot: string | null;
  invitation_status: string;
  attendance_status: string | null;
  delegate_name: string | null;
}

export interface ExternalParticipantRow {
  id: string;
  full_name: string;
  organization: string | null;
  position: string | null;
  mobile: string | null;
  email: string | null;
  attendance_status: string | null;
}

export interface AgendaResultRow {
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

export interface ApprovalRow {
  id: string;
  approver_user_id: string;
  status: ApprovalStatus;
  approved_at: string | null;
  changes_requested_at: string | null;
  approver_name: string;
}

export interface ApprovalCommentRow {
  id: string;
  agenda_result_id: string | null;
  reason: string;
  suggested_correction: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
}
