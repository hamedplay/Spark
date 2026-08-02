import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDocumentDataFromDraft } from '../../src/components/Minutes/MinutesDocumentFromDraft.ts';
import type { MinutesLayoutConfig } from '../../src/components/Minutes/MinutesDocumentData.ts';
import type {
  DraftMeetingInfo, DraftInternalParticipant, DraftExternalParticipant,
  DraftAgendaItem, DraftDecision,
} from '../../src/components/Minutes/Form/types.ts';

const baseInfo: DraftMeetingInfo = {
  meetingId: 'm1', meetingTitle: 'جلسه تست', meetingDate: '۱۴۰۳/۰۵/۰۱',
  meetingType: 'management', startTime: '۰۹:۰۰', endTime: '۱۱:۰۰',
  location: 'سالن جلسات', orgUnitId: 'u1', orgUnitNameSnapshot: 'واحد تست',
  secretaryUserId: 'sec1', secretaryNameSnapshot: 'دبیر تست',
  chairUserId: 'chair1', chairNameSnapshot: 'رئیس تست',
  notes: 'یادداشت', confidentiality: 'organizational',
  status: 'draft', approvalMode: 'system', revisionNumber: 1, submittedAt: null,
};

const internalParts: DraftInternalParticipant[] = [
  { id: 'p1', participantId: null, userId: 'u1', nameSnapshot: 'حاضر یک', positionSnapshot: 'کارمند', orgUnitId: '', orgUnitNameSnapshot: '', invitationStatus: 'accepted', attendanceStatus: 'present', delegate: '', delegateUserId: null, delegateName: '', notes: '', source: 'manual' },
  { id: 'p2', participantId: null, userId: 'u2', nameSnapshot: 'حاضر دو', positionSnapshot: 'مدیر', orgUnitId: '', orgUnitNameSnapshot: '', invitationStatus: 'accepted', attendanceStatus: 'present', delegate: '', delegateUserId: null, delegateName: '', notes: '', source: 'manual' },
  { id: 'p3', participantId: null, userId: 'u3', nameSnapshot: 'غائب یک', positionSnapshot: 'کارشناس', orgUnitId: '', orgUnitNameSnapshot: '', invitationStatus: 'accepted', attendanceStatus: 'absent', delegate: 'نماینده غائب', delegateUserId: null, delegateName: 'نماینده غائب', notes: '', source: 'manual' },
];

const externalParts: DraftExternalParticipant[] = [
  { id: 'e1', participantId: null, fullName: 'مهمان خارجی', organization: 'سازمان خارجی', position: 'مشاور', mobile: '', email: '', invitationStatus: 'invited', attendanceStatus: 'present', notes: '', source: 'manual' },
];

const agendaItems: DraftAgendaItem[] = [
  { id: 'a1', meetingAgendaItemId: null, order: 1, title: 'دستور جلسه یک', description: 'توضیح یک', presenter: 'ارائه‌دهنده', allocatedTime: '۱۰', discussionResult: '', resultType: 'discussion', additionalNotes: '' },
  { id: 'a2', meetingAgendaItemId: null, order: 2, title: 'دستور جلسه دو', description: 'توضیح دو', presenter: '', allocatedTime: '', discussionResult: '', resultType: 'action', additionalNotes: '' },
];

const decisions: DraftDecision[] = [
  { id: 'd1', decisionId: null, agendaResultId: null, meetingAgendaItemId: null, title: 'مصوبه یک', description: '', primaryOwnerUserId: 'u1', responsibleUnitId: null, responsibleUnitNameSnapshot: '', priority: 'normal', startDate: '', dueDate: '', requiresFollowup: false, latestUpdate: '', discussionResult: '', resultType: 'resolution', additionalNotes: '' },
  { id: 'd2', decisionId: null, agendaResultId: null, meetingAgendaItemId: null, title: 'مصوبه دو', description: '', primaryOwnerUserId: 'u2', responsibleUnitId: null, responsibleUnitNameSnapshot: '', priority: 'urgent', startDate: '', dueDate: '', requiresFollowup: true, latestUpdate: '', discussionResult: '', resultType: 'resolution', additionalNotes: '' },
];

const config: MinutesLayoutConfig = {
  headerTitle: 'صورت‌جلسه', orgName: 'سازمان', subtitle: '',
  footerText: '', showLogo: true, showParticipants: true,
  showApprovers: true, showConfidentiality: true, showDecisions: true,
  showNotes: true,
  fontSize: 'medium',
};

test('buildDocumentDataFromDraft maps attendance_status for internal participants', () => {
  const doc = buildDocumentDataFromDraft(baseInfo, internalParts, externalParts, agendaItems, decisions, [], [], null, config);
  const present = doc.internalParts.filter(p => p.attendance_status === 'present');
  const absent = doc.internalParts.filter(p => p.attendance_status === 'absent');
  assert.equal(present.length, 2, 'two present participants');
  assert.equal(absent.length, 1, 'one absent participant');
});

test('buildDocumentDataFromDraft maps delegate_name for internal participants', () => {
  const doc = buildDocumentDataFromDraft(baseInfo, internalParts, externalParts, agendaItems, decisions, [], [], null, config);
  const absentWithDelegate = doc.internalParts.find(p => p.attendance_status === 'absent');
  assert.ok(absentWithDelegate, 'absent participant exists');
  assert.equal(absentWithDelegate?.delegate_name, 'نماینده غائب', 'delegate_name mapped correctly');
});

test('buildDocumentDataFromDraft maps attendance_status for external participants', () => {
  const doc = buildDocumentDataFromDraft(baseInfo, internalParts, externalParts, agendaItems, decisions, [], [], null, config);
  assert.equal(doc.externalParts.length, 1, 'one external participant');
  assert.equal(doc.externalParts[0].attendance_status, 'present', 'external attendance_status mapped');
});

test('buildDocumentDataFromDraft maps agenda items with titles', () => {
  const doc = buildDocumentDataFromDraft(baseInfo, internalParts, externalParts, agendaItems, decisions, [], [], null, config);
  assert.equal(doc.agendaItems.length, 2, 'two agenda items');
  assert.equal(doc.agendaItems[0].title, 'دستور جلسه یک');
  assert.equal(doc.agendaItems[1].title, 'دستور جلسه دو');
});

test('buildDocumentDataFromDraft maps decisions', () => {
  const doc = buildDocumentDataFromDraft(baseInfo, internalParts, externalParts, agendaItems, decisions, [], [], null, config);
  assert.equal(doc.decisions.length, 2, 'two decisions');
  assert.equal(doc.decisions[0].title, 'مصوبه یک');
  assert.equal(doc.decisions[1].priority, 'urgent');
});

test('buildDocumentDataFromDraft respects showApprovers config', () => {
  const cfgNoApprovers = { ...config, showApprovers: false };
  const doc = buildDocumentDataFromDraft(baseInfo, internalParts, externalParts, agendaItems, decisions, [], [], null, cfgNoApprovers);
  assert.equal(doc.config?.showApprovers, false, 'showApprovers=false respected');
});

test('buildDocumentDataFromDraft defaults showApprovers to true when config undefined', () => {
  const doc = buildDocumentDataFromDraft(baseInfo, internalParts, externalParts, agendaItems, decisions, [], [], null);
  assert.equal(doc.config, undefined, 'config is undefined');
});
