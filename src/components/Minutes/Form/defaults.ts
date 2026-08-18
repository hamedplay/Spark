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
  participantId: null,
  userId: '',
  nameSnapshot: '',
  positionSnapshot: '',
  orgUnitId: '',
  orgUnitNameSnapshot: '',
  invitationStatus: 'invited',
  attendanceStatus: null,
  delegate: '',
  delegateUserId: null,
  delegateName: '',
  notes: '',
  source: 'manual',
});

export const defaultExternalParticipant = (): DraftExternalParticipant => ({
  id: uid(),
  participantId: crypto.randomUUID(),
  fullName: '',
  organization: '',
  position: '',
  mobile: '',
  email: '',
  invitationStatus: 'invited',
  attendanceStatus: null,
  notes: '',
  source: 'manual',
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
  decisionId: crypto.randomUUID(),
  parentDecisionId: null,
  clauseOrder: null,
  agendaResultId: null,
  meetingAgendaItemId: null,
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
  responsiblePartyType: 'internal',
  externalResponsibleParticipantId: null,
  externalResponsibleNameSnapshot: '',
  externalResponsibleOrganizationSnapshot: '',
  externalResponsiblePositionSnapshot: '',
});

export const defaultFinalization: DraftFinalization = {
  signDate: '',
  versionNumber: '',
  versionNotes: '',
};
