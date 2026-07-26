import type {
  DraftMeetingInfo, DraftInternalParticipant, DraftExternalParticipant,
  DraftAgendaItem, DraftDecision, DraftFinalization,
} from './types';

export const uid = () => String(Date.now()) + Math.random().toString(36).slice(2, 6);

export const defaultInfo: DraftMeetingInfo = {
  meetingId: '',
  meetingTitle: '',
  meetingDate: '',
  meetingType: '',
  startTime: '',
  endTime: '',
  location: '',
  orgUnitId: '',
  orgUnitNameSnapshot: '',
  secretaryUserId: '',
  secretaryNameSnapshot: '',
  chairUserId: '',
  chairNameSnapshot: '',
  notes: '',
  confidentiality: 'organizational',
  status: 'draft',
  approvalMode: '',
  revisionNumber: 1,
  submittedAt: null,
};

export const defaultInternalParticipant = (): DraftInternalParticipant => ({
  id: uid(),
  userId: '',
  nameSnapshot: '',
  positionSnapshot: '',
  orgUnitId: '',
  orgUnitNameSnapshot: '',
  invitationStatus: 'invited',
  attendanceStatus: null,
  delegate: '',
  notes: '',
});

export const defaultExternalParticipant = (): DraftExternalParticipant => ({
  id: uid(),
  fullName: '',
  organization: '',
  position: '',
  mobile: '',
  email: '',
  attendanceStatus: null,
});

export const defaultAgendaItem = (order: number): DraftAgendaItem => ({
  id: uid(),
  meetingAgendaItemId: '',
  order,
  title: '',
  description: '',
  presenter: '',
  allocatedTime: '',
  discussionResult: '',
  resultType: 'discussion',
  additionalNotes: '',
});

export const defaultDecision = (): DraftDecision => ({
  id: uid(),
  decisionId: null,
  agendaResultId: null,
  title: '',
  description: '',
  primaryOwnerUserId: '',
  responsibleUnitId: null,
  responsibleUnitNameSnapshot: '',
  priority: 'normal',
  startDate: '',
  dueDate: '',
  requiresFollowup: true,
  latestUpdate: '',
  discussionResult: '',
  resultType: 'discussion',
  additionalNotes: '',
});

export const defaultFinalization: DraftFinalization = {
  signDate: '',
  versionNumber: '',
  versionNotes: '',
};
