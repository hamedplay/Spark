import type { Dispatch, SetStateAction } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Save,
  Send,
  X,
  CalendarDays,
  CircleAlert as AlertCircle,
} from 'lucide-react';
import {
  getMeetingIdFromUrl,
  setMeetingIdInUrl,
  setMinuteIdInUrl,
} from '../../lib/minutesNavigation';
import { PageHeader, TableSkeleton } from './MinutesShared';
import { MinutesBackButton } from './MinutesBackButton';
import { SectionInfo } from './Form/SectionInfo';
import {
  SectionParticipants,
  type ExternalParticipantSuggestion,
} from './Form/SectionParticipants';
import { SectionAgenda } from './Form/SectionAgenda';
import { SectionDecisions } from './Form/SectionDecisions';
import { SectionAttachments } from './Form/SectionAttachments';
import { SectionApprovers } from './Form/SectionApprovers';
import { SectionFinal } from './Form/SectionFinal';
import { DebugPayloadPanel } from './Form/DebugPayloadPanel';
import { MINUTES_FORM_SECTIONS } from './MinutesFormConfig';
import type { MinutesLayoutConfig } from './MinutesDocumentData';
import type {
  DraftAgendaItem,
  DraftDecision,
  DraftExternalParticipant,
  DraftFinalization,
  DraftInternalParticipant,
  DraftMeetingInfo,
  MinutesDraftPayload,
  OrgUnitOption,
  ProfileOption,
} from './Form/types';

interface MinutesFormViewProps {
  mode: 'new' | 'edit';
  onNavigate: (page: string) => void;
  title: string;
  activeSection: number;
  setActiveSection: Dispatch<SetStateAction<number>>;
  info: DraftMeetingInfo;
  setInfo: Dispatch<SetStateAction<DraftMeetingInfo>>;
  internalParticipants: DraftInternalParticipant[];
  setInternalParticipants: Dispatch<SetStateAction<DraftInternalParticipant[]>>;
  externalParticipants: DraftExternalParticipant[];
  setExternalParticipants: Dispatch<SetStateAction<DraftExternalParticipant[]>>;
  agendaItems: DraftAgendaItem[];
  setAgendaItems: Dispatch<SetStateAction<DraftAgendaItem[]>>;
  decisions: DraftDecision[];
  setDecisions: Dispatch<SetStateAction<DraftDecision[]>>;
  deletedDecisionIds: string[];
  setDeletedDecisionIds: Dispatch<SetStateAction<string[]>>;
  deletedExternalParticipantIds: string[];
  setDeletedExternalParticipantIds: Dispatch<SetStateAction<string[]>>;
  finalization: DraftFinalization;
  setFinalization: Dispatch<SetStateAction<DraftFinalization>>;
  profiles: ProfileOption[];
  orgUnits: OrgUnitOption[];
  profilesLoading: boolean;
  orgUnitsLoading: boolean;
  profilesError: string | null;
  orgUnitsError: string | null;
  agendaLoading: boolean;
  savingDraft: boolean;
  externalSuggestions: ExternalParticipantSuggestion[];
  prefillLoading: boolean;
  prefillError: string | null;
  setPrefillAttempt: Dispatch<SetStateAction<number>>;
  editMinuteId: string | null;
  workingMinuteId: string | null;
  editLoading: boolean;
  editError: string | null;
  editNotFound: boolean;
  decisionsLoadFailed: boolean;
  logoUrl: string | null;
  docConfig: MinutesLayoutConfig | null;
  submitting: boolean;
  handleSaveDraft: () => void;
  handleSubmitForApproval: () => void;
  payload: MinutesDraftPayload;
  isDev: boolean;
}

export function MinutesFormView({
  mode,
  onNavigate,
  title,
  activeSection,
  setActiveSection,
  info,
  setInfo,
  internalParticipants,
  setInternalParticipants,
  externalParticipants,
  setExternalParticipants,
  agendaItems,
  setAgendaItems,
  decisions,
  setDecisions,
  deletedDecisionIds,
  setDeletedDecisionIds,
  deletedExternalParticipantIds,
  setDeletedExternalParticipantIds,
  finalization,
  setFinalization,
  profiles,
  orgUnits,
  profilesLoading,
  orgUnitsLoading,
  profilesError,
  orgUnitsError,
  agendaLoading,
  savingDraft,
  externalSuggestions,
  prefillLoading,
  prefillError,
  setPrefillAttempt,
  editMinuteId,
  workingMinuteId,
  editLoading,
  editError,
  editNotFound,
  decisionsLoadFailed,
  logoUrl,
  docConfig,
  submitting,
  handleSaveDraft,
  handleSubmitForApproval,
  payload,
  isDev,
}: MinutesFormViewProps) {
  if (mode === 'new' && !getMeetingIdFromUrl()) {
    return (
      <div dir="rtl" className="space-y-5">
        <PageHeader title={title} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <CalendarDays className="w-10 h-10 text-gray-400 mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">جلسه‌ای انتخاب نشده</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">برای ثبت صورت‌جلسه ابتدا باید یک جلسه را از تقویم انتخاب کنید.</p>
          <button onClick={() => onNavigate('calendar')} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
            <CalendarDays className="w-4 h-4" />
            رفتن به تقویم
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'edit' && editLoading) {
    return (
      <div dir="rtl" className="space-y-5">
        <PageHeader title={title} />
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
          <TableSkeleton rows={6} />
        </div>
      </div>
    );
  }

  if (mode === 'edit' && editNotFound) {
    return (
      <div dir="rtl" className="space-y-5">
        <PageHeader title={title} />
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <AlertCircle className="w-10 h-10 text-gray-400 mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">صورت‌جلسه‌ای یافت نشد</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">این صورت‌جلسه وجود ندارد، حذف شده است، یا شما دسترسی ویرایش آن را ندارید.</p>
          <button onClick={() => onNavigate('minutes')} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors">
            بازگشت به لیست
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'edit' && editError) {
    return (
      <div dir="rtl" className="space-y-5">
        <PageHeader title={title} />
        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
          {editError}
        </div>
      </div>
    );
  }

  const isNonEditable = mode === 'edit' && info.status !== 'draft' && info.status !== 'changes_requested';

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader
        title={title}
        actions={
          <div className="flex items-center gap-2">
            <MinutesBackButton
              label={mode === 'new' ? 'بازگشت به صورت‌جلسات' : 'بازگشت به جزئیات صورت‌جلسه'}
              onClick={() => {
                if (mode === 'new') {
                  const meetingId = getMeetingIdFromUrl();
                  if (meetingId) {
                    setMeetingIdInUrl(meetingId);
                    onNavigate('calendar');
                  } else {
                    onNavigate('minutes');
                  }
                } else {
                  const minuteId = editMinuteId || workingMinuteId;
                  if (minuteId) setMinuteIdInUrl(minuteId);
                  onNavigate('minutes-detail');
                }
              }}
            />
            <button
              onClick={() => onNavigate('minutes')}
              className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm transition-colors"
            >
              <X className="w-4 h-4" />
              انصراف
            </button>
          </div>
        }
      />

      <div className="flex gap-5">
        <div className="hidden lg:flex flex-col gap-1 w-48 flex-shrink-0">
          {MINUTES_FORM_SECTIONS.map((section, index) => {
            const Icon = section.icon;
            const isActive = index === activeSection;
            const isDone = index < activeSection;
            return (
              <button
                key={section.id}
                onClick={() => setActiveSection(index)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-right ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : isDone
                      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{section.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 min-w-0">
          <div className="lg:hidden flex gap-1 overflow-x-auto pb-2 mb-4">
            {MINUTES_FORM_SECTIONS.map((section, index) => (
              <button
                key={section.id}
                onClick={() => setActiveSection(index)}
                className={`flex-shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                  index === activeSection
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                {section.label}
              </button>
            ))}
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
            {activeSection === 0 && (
              <SectionInfo
                info={info}
                setInfo={setInfo}
                profiles={profiles}
                profilesLoading={profilesLoading}
                profilesError={profilesError}
                orgUnits={orgUnits}
                orgUnitsLoading={orgUnitsLoading}
                orgUnitsError={orgUnitsError}
                prefillLoading={prefillLoading}
                prefillError={prefillError}
                onRetryPrefill={() => setPrefillAttempt(attempt => attempt + 1)}
                isMeetingPrefilled={mode === 'new' && !!info.meetingId}
                agendaLoading={agendaLoading}
                internalParticipants={internalParticipants}
                readOnly={isNonEditable}
                hideLocation={false}
              />
            )}
            {activeSection === 1 && (
              <SectionParticipants
                internalParticipants={internalParticipants}
                setInternalParticipants={setInternalParticipants}
                externalParticipants={externalParticipants}
                setExternalParticipants={setExternalParticipants}
                profiles={profiles}
                profilesLoading={profilesLoading}
                profilesError={profilesError}
                orgUnits={orgUnits}
                orgUnitsLoading={orgUnitsLoading}
                orgUnitsError={orgUnitsError}
                invitationStatusReadOnly={mode === 'new'}
                readOnly={isNonEditable}
                externalSuggestions={externalSuggestions}
                onRemoveExternalParticipant={participantId => {
                  if (participantId && !deletedExternalParticipantIds.includes(participantId)) {
                    setDeletedExternalParticipantIds(previous => [...previous, participantId]);
                  }
                }}
              />
            )}
            {activeSection === 2 && (
              <SectionAgenda
                agendaItems={agendaItems}
                setAgendaItems={setAgendaItems}
                agendaLoading={agendaLoading}
                internalParticipants={internalParticipants}
                externalParticipants={externalParticipants}
              />
            )}
            {activeSection === 3 && (
              <SectionDecisions
                decisions={decisions}
                setDecisions={setDecisions}
                profiles={profiles}
                profilesLoading={profilesLoading}
                orgUnits={orgUnits}
                orgUnitsLoading={orgUnitsLoading}
                agendaItems={agendaItems}
                externalParticipants={externalParticipants.map(participant => ({
                  id: participant.id,
                  participantId: participant.participantId,
                  fullName: participant.fullName,
                  organization: participant.organization,
                  position: participant.position,
                  mobile: participant.mobile,
                }))}
                readOnly={isNonEditable}
                onRemoveDecision={decisionId => {
                  if (decisionId && !deletedDecisionIds.includes(decisionId)) {
                    setDeletedDecisionIds(previous => [...previous, decisionId]);
                  }
                }}
              />
            )}
            {activeSection === 4 && (
              <SectionAttachments
                minuteId={mode === 'edit' ? editMinuteId : workingMinuteId}
                canManage={!isNonEditable}
              />
            )}
            {activeSection === 5 && (
              <SectionApprovers
                approvalMode={info.approvalMode}
                internalParticipants={internalParticipants}
                profiles={profiles}
                readOnly={isNonEditable}
              />
            )}
            {activeSection === 6 && (
              <SectionFinal
                finalization={finalization}
                setFinalization={setFinalization}
                info={info}
                internalParticipants={internalParticipants}
                externalParticipants={externalParticipants}
                agendaItems={agendaItems}
                decisions={decisions}
                profiles={profiles}
                orgUnits={orgUnits}
                logoUrl={logoUrl}
                config={docConfig}
                minuteId={mode === 'edit' ? editMinuteId : workingMinuteId}
                canManage={true}
              />
            )}
          </div>

          <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
            <button
              onClick={() => setActiveSection(section => Math.max(0, section - 1))}
              disabled={activeSection === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
              بخش قبلی
            </button>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleSaveDraft}
                disabled={savingDraft || decisionsLoadFailed}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Save className="w-4 h-4" />
                {savingDraft ? 'در حال ذخیره...' : 'ذخیره پیش‌نویس'}
              </button>
              {decisionsLoadFailed && (
                <span className="text-xs text-red-500">ذخیره غیرفعال — بارگذاری مصوبات ناموفق بود</span>
              )}
              {activeSection === MINUTES_FORM_SECTIONS.length - 1 ? (
                <button
                  onClick={handleSubmitForApproval}
                  disabled={submitting || savingDraft || !info.approvalMode}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-4 h-4" />
                  {submitting ? 'در حال ارسال...' : 'ارسال برای تأیید'}
                </button>
              ) : (
                <button
                  onClick={() => setActiveSection(section => Math.min(MINUTES_FORM_SECTIONS.length - 1, section + 1))}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  ذخیره و ادامه
                  <ChevronLeft className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {isDev && <DebugPayloadPanel payload={payload} />}
    </div>
  );
}
