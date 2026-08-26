import type { MinutesDocumentData, DocDecision, MinutesLayoutConfig } from './MinutesDocumentData';
import type {
  DraftMeetingInfo, DraftInternalParticipant, DraftExternalParticipant,
  DraftAgendaItem, DraftDecision, ProfileOption, OrgUnitOption,
} from './Form/types';
import type { DecisionPriority, DecisionStatus } from './types';
import { getDraftDecisionClauses, getParentDraftDecisions } from './decisionHierarchy';

export function buildDocumentDataFromDraft(
  info: DraftMeetingInfo,
  internalParticipants: DraftInternalParticipant[],
  externalParticipants: DraftExternalParticipant[],
  agendaItems: DraftAgendaItem[],
  decisions: DraftDecision[],
  profiles: ProfileOption[],
  orgUnits: OrgUnitOption[],
  logoUrl: string | null,
  config?: MinutesLayoutConfig | null,
): MinutesDocumentData {
  const profileLabel = (uid: string): string => {
    const p = profiles.find(x => x.user_id === uid);
    return p?.full_name || p?.username || uid;
  };
  const unitLabel = (uid: string | null): string | null => {
    if (!uid) return null;
    const u = orgUnits.find(x => x.id === uid);
    return u?.name || null;
  };

  const docDecisions: DocDecision[] = getParentDraftDecisions(decisions).map(parent => {
    const clauses = getDraftDecisionClauses(decisions, parent.decisionId);
    return {
      id: parent.id,
      title: parent.title,
      description: parent.description,
      primaryOwnerName: parent.responsiblePartyType === 'external'
        ? parent.externalResponsibleNameSnapshot
        : profileLabel(parent.primaryOwnerUserId),
      responsibleUnitName: parent.responsiblePartyType === 'external'
        ? (parent.externalResponsibleOrganizationSnapshot || null)
        : (parent.responsibleUnitNameSnapshot || unitLabel(parent.responsibleUnitId)),
      priority: parent.priority as DecisionPriority,
      startDate: parent.startDate,
      dueDate: parent.dueDate,
      status: 'not_started' as DecisionStatus,
      progressPercent: 0,
      latestUpdate: parent.latestUpdate,
      discussionResult: parent.discussionResult,
      resultType: parent.resultType,
      additionalNotes: parent.additionalNotes,
      clauses: clauses.map(clause => ({
        id: clause.id,
        order: clause.clauseOrder || 1,
        text: clause.description || clause.title,
        responsibleUnitName: clause.responsiblePartyType === 'external'
          ? (clause.externalResponsibleOrganizationSnapshot || null)
          : (clause.responsibleUnitNameSnapshot || unitLabel(clause.responsibleUnitId)),
        dueDate: clause.dueDate,
      })),
    };
  });

  return {
    minute: {
      meeting_title_snapshot: info.meetingTitle,
      meeting_date_snapshot: info.meetingDate,
      meeting_start_time_snapshot: info.startTime || null,
      meeting_end_time_snapshot: info.endTime || null,
      meeting_location_snapshot: info.location || null,
      meeting_type: info.meetingType || null,
      org_unit_name_snapshot: info.orgUnitNameSnapshot || null,
      secretary_name_snapshot: info.secretaryNameSnapshot,
      chair_name_snapshot: info.chairNameSnapshot,
      notes: info.notes || null,
      confidentiality: info.confidentiality,
      status: info.status,
      approval_mode: info.approvalMode || null,
      revision_number: info.revisionNumber,
      secretary_confirmed_at: null,
      chair_confirmed_at: null,
      published_at: null,
    },
    internalParts: internalParticipants
      .filter(p => p.nameSnapshot || p.userId)
      .map(p => ({
        id: p.id,
        name_snapshot: p.nameSnapshot || profileLabel(p.userId),
        position_snapshot: p.positionSnapshot || null,
        org_unit_name_snapshot: p.orgUnitNameSnapshot || null,
        attendance_status: p.attendanceStatus ?? null,
        delegate_name: p.delegateName || null,
      })),
    externalParts: externalParticipants
      .filter(p => p.fullName)
      .map(p => ({
        id: p.id,
        full_name: p.fullName,
        organization: p.organization || null,
        position: p.position || null,
        attendance_status: p.attendanceStatus ?? null,
      })),
    agendaItems: agendaItems
      .filter(a => a.title)
      .map(a => ({
        id: a.id,
        order: a.order,
        title: a.title,
        description: a.description,
        presenter: a.presenter || '',
        allocatedTime: a.allocatedTime || null,
      })),
    decisions: docDecisions,
    approvals: [],
    approvalComments: [],
    logoUrl,
    config: config || undefined,
  };
}
