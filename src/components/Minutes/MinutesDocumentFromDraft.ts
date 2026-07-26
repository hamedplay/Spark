import type { MinutesDocumentData, DocDecision } from './MinutesDocumentData';
import type {
  DraftMeetingInfo, DraftInternalParticipant, DraftExternalParticipant,
  DraftAgendaItem, DraftDecision, ProfileOption, OrgUnitOption,
} from './Form/types';
import type { DecisionPriority, DecisionStatus } from './types';

export function buildDocumentDataFromDraft(
  info: DraftMeetingInfo,
  internalParticipants: DraftInternalParticipant[],
  externalParticipants: DraftExternalParticipant[],
  agendaItems: DraftAgendaItem[],
  decisions: DraftDecision[],
  profiles: ProfileOption[],
  orgUnits: OrgUnitOption[],
  logoUrl: string | null,
): MinutesDocumentData {
  const profileLabel = (uid: string): string => {
    const p = profiles.find(x => x.user_id === uid);
    return p?.full_name || p?.email || uid;
  };
  const unitLabel = (uid: string | null): string | null => {
    if (!uid) return null;
    const u = orgUnits.find(x => x.id === uid);
    return u?.name || null;
  };

  const docDecisions: DocDecision[] = decisions.map(d => ({
    id: d.id,
    title: d.title,
    description: d.description,
    primaryOwnerName: profileLabel(d.primaryOwnerUserId),
    responsibleUnitName: d.responsibleUnitNameSnapshot || unitLabel(d.responsibleUnitId),
    priority: d.priority as DecisionPriority,
    startDate: d.startDate,
    dueDate: d.dueDate,
    status: 'not_started' as DecisionStatus,
    progressPercent: 0,
    latestUpdate: d.latestUpdate,
    discussionResult: d.discussionResult,
    resultType: d.resultType,
    additionalNotes: d.additionalNotes,
  }));

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
      })),
    externalParts: externalParticipants
      .filter(p => p.fullName)
      .map(p => ({
        id: p.id,
        full_name: p.fullName,
        organization: p.organization || null,
        position: p.position || null,
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
  };
}
