import { normalizeInvitationStatus } from '../../lib/minutesInvitationStatus';
import type {
  DraftAgendaItem,
  DraftDecision,
  DraftExternalParticipant,
  DraftInternalParticipant,
  DraftMeetingInfo,
  ProfileOption,
} from './Form/types';
import { getDraftDecisionClauses, getParentDraftDecisions } from './decisionHierarchy';

interface PayloadInput {
  info: DraftMeetingInfo;
  internalParticipants: DraftInternalParticipant[];
  externalParticipants: DraftExternalParticipant[];
  agendaItems: DraftAgendaItem[];
  decisions: DraftDecision[];
  profiles: ProfileOption[];
}

export function buildMinutesDraftPayload({
  info,
  internalParticipants,
  externalParticipants,
  agendaItems,
  decisions,
  profiles,
}: PayloadInput) {
  return {
    meeting_title_snapshot: info.meetingTitle,
    meeting_date_snapshot: info.meetingDate,
    meeting_start_time_snapshot: info.startTime || null,
    meeting_end_time_snapshot: info.endTime || null,
    meeting_location_snapshot: info.location || null,
    meeting_type: info.meetingType || null,
    org_unit_id: info.orgUnitId || null,
    org_unit_name_snapshot: info.orgUnitNameSnapshot || null,
    secretary_user_id: info.secretaryUserId || null,
    secretary_name_snapshot: info.secretaryNameSnapshot,
    chair_user_id: info.chairUserId || null,
    chair_name_snapshot: info.chairNameSnapshot,
    notes: info.notes || null,
    confidentiality: info.confidentiality,
    approval_mode: info.approvalMode || null,

    internal_participants: internalParticipants
      .filter(participant => participant.nameSnapshot.trim() || participant.userId)
      .map(participant => {
        const resolvedName = participant.nameSnapshot.trim() || (
          participant.userId
            ? (profiles.find(profile => profile.user_id === participant.userId)?.full_name || '')
            : ''
        );
        return {
          user_id: participant.userId || null,
          name_snapshot: resolvedName || participant.nameSnapshot,
          position_snapshot: participant.positionSnapshot || null,
          org_unit_id: participant.orgUnitId || null,
          org_unit_name_snapshot: participant.orgUnitNameSnapshot || null,
          invitation_status: normalizeInvitationStatus(participant.invitationStatus),
          attendance_status: participant.attendanceStatus || null,
          notes: participant.notes || null,
          delegate_user_id: participant.delegateUserId || null,
          delegate_name: participant.delegateName || null,
        };
      }),

    external_participants: externalParticipants
      .filter(participant => participant.fullName.trim())
      .map(participant => ({
        id: participant.participantId,
        full_name: participant.fullName,
        organization: participant.organization || null,
        position: participant.position || null,
        mobile: participant.mobile || null,
        email: participant.email || null,
        invitation_status: normalizeInvitationStatus(participant.invitationStatus),
        attendance_status: participant.attendanceStatus || null,
        notes: participant.notes || null,
      })),

    agenda_results: agendaItems
      .filter(item => item.title.trim())
      .map(item => ({
        meeting_agenda_item_id: item.meetingAgendaItemId || null,
        sort_order_snapshot: item.order,
        agenda_title_snapshot: item.title,
        agenda_description_snapshot: item.description || null,
        presenter_snapshot: item.presenter || null,
        allocated_minutes_snapshot:
          item.allocatedTime && item.allocatedTime.trim()
            ? Number.parseInt(item.allocatedTime, 10)
            : null,
        discussion_result: null,
        result_type: null,
        additional_notes: null,
      })),

    decisions: buildDecisionsPayload(decisions),
  };
}

function serializeDecision(
  decision: DraftDecision,
  executionSource: DraftDecision,
  parent: DraftDecision | undefined,
) {
  return {
    id: decision.decisionId || null,
    parent_decision_id: decision.parentDecisionId || null,
    clause_order: decision.parentDecisionId ? decision.clauseOrder : null,
    meeting_agenda_item_id: (parent?.meetingAgendaItemId || decision.meetingAgendaItemId) || null,
    agenda_result_id: null,
    title: decision.title.trim(),
    description: decision.description || null,
    primary_owner_user_id: executionSource.responsiblePartyType === 'external'
      ? null
      : (executionSource.primaryOwnerUserId || null),
    responsible_unit_id: executionSource.responsibleUnitId || null,
    responsible_unit_name_snapshot: executionSource.responsibleUnitNameSnapshot || null,
    priority: executionSource.priority,
    start_date: executionSource.startDate || null,
    due_date: executionSource.dueDate || null,
    requires_followup: executionSource.requiresFollowup,
    latest_update: executionSource.latestUpdate || null,
    discussion_result: decision.discussionResult || null,
    result_type: decision.resultType || null,
    additional_notes: decision.additionalNotes || null,
    responsible_party_type: executionSource.responsiblePartyType,
    external_responsible_participant_id: executionSource.externalResponsibleParticipantId || null,
    external_responsible_name_snapshot: executionSource.externalResponsibleNameSnapshot || null,
    external_responsible_organization_snapshot: executionSource.externalResponsibleOrganizationSnapshot || null,
    external_responsible_position_snapshot: executionSource.externalResponsiblePositionSnapshot || null,
  };
}

export function buildDecisionsPayload(decisions: DraftDecision[]) {
  const byId = new Map(
    decisions
      .filter(decision => decision.decisionId)
      .map(decision => [decision.decisionId as string, decision]),
  );

  return decisions.map(decision => {
    const parent = decision.parentDecisionId ? byId.get(decision.parentDecisionId) : undefined;
    const clauses = !decision.parentDecisionId
      ? getDraftDecisionClauses(decisions, decision.decisionId)
      : [];
    // The parent remains non-executable in the UI, but existing DB constraints
    // require compatible execution fields. Mirror the first clause internally.
    const executionSource = clauses.length > 0 ? clauses[0] : decision;
    return serializeDecision(decision, executionSource, parent);
  });
}

function validateExecutionOwner(decision: DraftDecision, noun: 'مصوبه' | 'بند'): string | null {
  if (decision.responsiblePartyType === 'internal' && !decision.primaryOwnerUserId) {
    return `انتخاب مسئول برای هر ${noun} الزامی است`;
  }
  if (decision.responsiblePartyType === 'external' && !decision.externalResponsibleNameSnapshot.trim()) {
    return `انتخاب مسئول خارج سازمان برای هر ${noun} الزامی است`;
  }
  if (decision.startDate && decision.dueDate && decision.dueDate < decision.startDate) {
    return `مهلت ${noun} نمی‌تواند قبل از تاریخ شروع باشد`;
  }
  return null;
}

export function validateMinutesForm({
  info,
  decisions,
  prefillLoading,
  prefillError,
}: {
  info: DraftMeetingInfo;
  decisions: DraftDecision[];
  prefillLoading: boolean;
  prefillError: string | null;
}): string | null {
  if (prefillLoading) return 'در حال بارگذاری اطلاعات جلسه...';
  if (prefillError) return 'بارگذاری اطلاعات جلسه ناموفق بود. دوباره تلاش کنید.';
  if (!info.meetingId) return 'انتخاب جلسه الزامی است';
  if (!info.meetingTitle.trim()) return 'عنوان جلسه الزامی است';
  if (!info.meetingDate.trim()) return 'تاریخ جلسه الزامی است';
  if (!info.secretaryUserId) return 'انتخاب دبیر جلسه الزامی است';
  if (!info.chairUserId) return 'انتخاب رئیس جلسه الزامی است';

  const parents = getParentDraftDecisions(decisions);
  if (parents.length !== decisions.filter(decision => !decision.parentDecisionId).length) {
    return 'ساختار مصوبات نامعتبر است';
  }

  for (const parent of parents) {
    if (!parent.title.trim()) return 'عنوان هر مصوبه الزامی است';
    const clauses = getDraftDecisionClauses(decisions, parent.decisionId);
    if (clauses.length === 0) {
      const ownerError = validateExecutionOwner(parent, 'مصوبه');
      if (ownerError) return ownerError;
      continue;
    }

    for (const clause of clauses) {
      if (!clause.title.trim()) return 'متن هر بند الزامی است';
      const ownerError = validateExecutionOwner(clause, 'بند');
      if (ownerError) return ownerError;
    }
  }

  const parentIds = new Set(parents.map(parent => parent.decisionId).filter(Boolean));
  if (decisions.some(decision => decision.parentDecisionId && !parentIds.has(decision.parentDecisionId))) {
    return 'یکی از بندها به مصوبه معتبر متصل نیست';
  }

  return null;
}
