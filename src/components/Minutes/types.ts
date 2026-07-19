// Minutes module frontend types
// These are UI-only types — no database schema should be created from these.

export type MinutesStatus =
  | 'draft'
  | 'pending_approval'
  | 'changes_requested'
  | 'approved'
  | 'published';

export type ConfidentialityLevel =
  | 'public'
  | 'organizational'
  | 'restricted'
  | 'confidential';

export type ApprovalMode = 'system' | 'in_person';

export type ApprovalMethod = 'digital' | 'in_person';

export type ApprovalStatus = 'pending' | 'approved' | 'changes_requested' | 'invalidated';

export type InvitationStatus =
  | 'invited'
  | 'accepted'
  | 'declined'
  | 'no_response'
  | 'delegated';

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'online'
  | 'late'
  | 'delegate_attended';

export type AgendaResultType =
  | 'discussion'
  | 'action'
  | 'resolution'
  | 'deferred'
  | 'no_result';

export type DecisionPriority = 'low' | 'normal' | 'important' | 'urgent';

export type DecisionStatus =
  | 'not_started'
  | 'planned'
  | 'in_progress'
  | 'waiting_coordination'
  | 'waiting_approval'
  | 'completed'
  | 'stopped';

export interface InternalParticipant {
  id: string;
  name: string;
  position: string;
  orgUnit: string;
  invitationStatus: InvitationStatus;
  attendanceStatus: AttendanceStatus;
  delegate?: string;
  notes?: string;
}

export interface ExternalParticipant {
  id: string;
  fullName: string;
  organization: string;
  position: string;
  mobile?: string;
  email?: string;
  attendanceStatus: AttendanceStatus;
}

export interface AgendaItem {
  id: string;
  order: number;
  title: string;
  description?: string;
  presenter?: string;
  allocatedTime?: number;
  discussionResult?: string;
  resultType: AgendaResultType;
  additionalNotes?: string;
}

export interface DecisionSummary {
  id: string;
  title: string;
  description: string;
  agendaItemId?: string;
  priority: DecisionPriority;
  status: DecisionStatus;
  primaryOwner: string;
  collaborators: string[];
  proposedBy?: string;
  responsibleUnit?: string;
  startDate?: string;
  deadline?: string;
  progressPercent: number;
  notes?: string;
  requiresFollowup: boolean;
  confidentiality: ConfidentialityLevel;
}

export interface ApprovalSummary {
  id: string;
  approverName: string;
  position: string;
  unit: string;
  approvalOrder: number;
  method: ApprovalMethod;
  status: ApprovalStatus;
  notes?: string;
}

export interface MinuteSummary {
  id: string;
  meetingTitle: string;
  meetingDate: string;
  secretary: string;
  chair: string;
  status: MinutesStatus;
  confidentiality: ConfidentialityLevel;
  decisionCount: number;
  lastModified: string;
  version: string;
  orgUnit?: string;
  approvalMode?: ApprovalMode | null;
  revisionNumber?: number;
}

export interface MinuteApprovalRow {
  id: string;
  minute_id: string;
  revision_number: number;
  approver_user_id: string;
  approver_name: string;
  status: ApprovalStatus;
  approved_at: string | null;
  changes_requested_at: string | null;
}

export interface MinuteApprovalCommentRow {
  id: string;
  approval_id: string;
  minute_id: string;
  revision_number: number;
  agenda_result_id: string | null;
  agenda_title: string | null;
  reason: string;
  suggested_correction: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
}

export interface HistoryEvent {
  id: string;
  actor: string;
  action: string;
  timestamp: string;
  notes?: string;
}

// ── Decision DB row types (match public.minutes_decisions) ──────────────────

export interface DecisionRow {
  id: string;
  minute_id: string;
  agenda_result_id: string | null;
  title: string;
  description: string | null;
  primary_owner_user_id: string;
  responsible_unit_id: string | null;
  responsible_unit_name_snapshot: string | null;
  priority: DecisionPriority;
  status: DecisionStatus;
  progress_percent: number;
  start_date: string | null;
  due_date: string | null;
  completed_at: string | null;
  requires_followup: boolean;
  latest_update: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

// Row returned by get_my_minutes_decisions RPC (decision fields + minute metadata)
export interface MyDecisionRow extends DecisionRow {
  minute_title: string;
  minute_status: MinutesStatus;
  meeting_date_snapshot: string;
  overdue: boolean;
  agenda_title: string | null;
}

// Row from minutes_decision_updates (history)
export interface DecisionUpdateRow {
  id: string;
  decision_id: string;
  minute_id: string;
  previous_status: DecisionStatus | null;
  new_status: DecisionStatus;
  previous_progress_percent: number | null;
  new_progress_percent: number;
  update_text: string | null;
  created_by_user_id: string;
  created_at: string;
  created_by_name?: string;
}

// Payload shape accepted by _minutes_decisions_sync (via create/update_minutes_draft)
export interface DecisionDraftPayload {
  id?: string | null;
  agenda_result_id?: string | null;
  title: string;
  description?: string | null;
  primary_owner_user_id: string;
  responsible_unit_id?: string | null;
  responsible_unit_name_snapshot?: string | null;
  priority: DecisionPriority;
  start_date?: string | null;
  due_date?: string | null;
  requires_followup?: boolean;
  latest_update?: string | null;
}

// Result of update_decision_progress RPC
export interface UpdateDecisionProgressResult {
  success: boolean;
  decision_id?: string;
  status?: DecisionStatus;
  progress_percent?: number;
  completed_at?: string | null;
  updated_at?: string;
  history_written?: boolean;
  error_code?: string;
  message?: string;
}
