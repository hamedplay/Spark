// Minutes module frontend types
// These are UI-only types — no database schema should be created from these.

export type MinutesStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'published';

export type ConfidentialityLevel =
  | 'public'
  | 'organizational'
  | 'restricted'
  | 'confidential';

export type ApprovalMethod = 'digital' | 'in_person';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

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
}

export interface HistoryEvent {
  id: string;
  actor: string;
  action: string;
  timestamp: string;
  notes?: string;
}
