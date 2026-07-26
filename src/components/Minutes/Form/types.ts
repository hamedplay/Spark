import type {
  ConfidentialityLevel, InvitationStatus, AttendanceStatus,
  AgendaResultType, DecisionPriority,
  MinutesStatus, ApprovalMode,
} from '../types';

export interface MeetingOption {
  id: string;
  subject: string;
  request_date: string | null;
  start_time: string | null;
  end_time: string | null;
  location: string;
  status_type: string;
  user_id: string;
  meeting_manager: string | null;
  participant_user_ids: string[] | null;
  org_unit_id: string | null;
}

export interface ProfileOption {
  user_id: string;
  full_name: string | null;
  email: string | null;
  position: string | null;
  primary_unit_id: string | null;
}

export interface OrgUnitOption {
  id: string;
  name: string;
}

export interface AgendaItemOption {
  id: string;
  title: string;
  presenter: string | null;
  duration_minutes: number | null;
  sort_order: number;
}

export interface DraftMeetingInfo {
  meetingId: string;
  meetingTitle: string;
  meetingDate: string;
  meetingType: string;
  startTime: string;
  endTime: string;
  location: string;
  orgUnitId: string;
  orgUnitNameSnapshot: string;
  secretaryUserId: string;
  secretaryNameSnapshot: string;
  chairUserId: string;
  chairNameSnapshot: string;
  notes: string;
  confidentiality: ConfidentialityLevel;
  status: MinutesStatus;
  approvalMode: ApprovalMode | '';
  revisionNumber: number;
  submittedAt: string | null;
}

export interface DraftInternalParticipant {
  id: string;
  userId: string;
  nameSnapshot: string;
  positionSnapshot: string;
  orgUnitId: string;
  orgUnitNameSnapshot: string;
  invitationStatus: InvitationStatus;
  attendanceStatus: AttendanceStatus | null;
  delegate: string;
  notes: string;
}

export interface DraftExternalParticipant {
  id: string;
  fullName: string;
  organization: string;
  position: string;
  mobile: string;
  email: string;
  attendanceStatus: AttendanceStatus | null;
}

export interface DraftAgendaItem {
  id: string;
  meetingAgendaItemId: string;
  order: number;
  title: string;
  description: string;
  presenter: string;
  allocatedTime: string;
  discussionResult: string;
  resultType: AgendaResultType;
  additionalNotes: string;
}

export interface DraftDecision {
  id: string;
  decisionId: string | null;
  agendaResultId: string | null;
  title: string;
  description: string;
  primaryOwnerUserId: string;
  responsibleUnitId: string | null;
  responsibleUnitNameSnapshot: string;
  priority: DecisionPriority;
  startDate: string;
  dueDate: string;
  requiresFollowup: boolean;
  latestUpdate: string;
  discussionResult: string;
  resultType: AgendaResultType;
  additionalNotes: string;
}

export interface DraftFinalization {
  signDate: string;
  versionNumber: string;
  versionNotes: string;
}

export interface MinutesDraftPayload {
  info: DraftMeetingInfo;
  internalParticipants: DraftInternalParticipant[];
  externalParticipants: DraftExternalParticipant[];
  agendaItems: DraftAgendaItem[];
  decisions: DraftDecision[];
  finalization: DraftFinalization;
}
