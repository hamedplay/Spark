import type {
  Dispatch,
  FormEvent,
  RefObject,
  SetStateAction,
} from 'react';
import { Bell, Users } from 'lucide-react';
import type { AgendaItem, ContactEmail } from '../../types';
import { MultiSelectField } from './MultiSelectField';
import { FormHeader } from './FormHeader';
import { FormFooter } from './FormFooter';
import { EditDecisionModal } from './EditDecisionModal';
import { CalendarSelectorSection } from './CalendarSelectorSection';
import { DateTimeSection } from './DateTimeSection';
import { CoreFieldsSection } from './CoreFieldsSection';
import { ExternalParticipantsSection } from './ExternalParticipantsSection';
import { MeetingManagerSection } from './MeetingManagerSection';
import { RepeatSection } from './RepeatSection';
import { ReminderSection } from './ReminderSection';
import { AgendaSection } from './AgendaSection';
import { OnlineMeetingSection, SmsOptionsSection } from './OptionsSections';
import type { CalendarEntry, CommitSnapshot } from './types';
import type { MeetingChangeSet } from '../../lib/meetingEditDiff';

interface SelectItem {
  id: string;
  name: string;
}

interface SelectGroup {
  label: string;
  options: Array<{ id: string; name: string; sub?: string }>;
}

interface ExternalOption {
  id: string;
  name: string;
  sub?: string;
}

interface CalendarMeetingFormViewProps {
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  calendars: CalendarEntry[];
  selectedCalendarId: string;
  setSelectedCalendarId: Dispatch<SetStateAction<string>>;
  selectedCalendar?: CalendarEntry;
  membersOnly: boolean;
  setMembersOnly: Dispatch<SetStateAction<boolean>>;
  scheduleDate: { jy: number; jm: number; jd: number } | null;
  setScheduleDate: Dispatch<SetStateAction<{ jy: number; jm: number; jd: number } | null>>;
  showManualDateTime: boolean;
  setShowManualDateTime: Dispatch<SetStateAction<boolean>>;
  manualDateStr: string;
  setManualDateStr: Dispatch<SetStateAction<string>>;
  manualStartTime: string;
  setManualStartTime: Dispatch<SetStateAction<string>>;
  manualEndTime: string;
  setManualEndTime: Dispatch<SetStateAction<string>>;
  startTime: string;
  setStartTime: Dispatch<SetStateAction<string>>;
  endTime: string;
  setEndTime: Dispatch<SetStateAction<string>>;
  subject: string;
  setSubject: Dispatch<SetStateAction<string>>;
  location: string;
  setLocation: Dispatch<SetStateAction<string>>;
  representative: string;
  setRepresentative: Dispatch<SetStateAction<string>>;
  setRepFromContacts: Dispatch<SetStateAction<boolean>>;
  repPickerRef: RefObject<HTMLDivElement | null>;
  showRepPicker: boolean;
  setShowRepPicker: Dispatch<SetStateAction<boolean>>;
  repPickerSearch: string;
  setRepPickerSearch: Dispatch<SetStateAction<string>>;
  allContacts: ContactEmail[];
  phone: string;
  setPhone: Dispatch<SetStateAction<string>>;
  priority: string;
  setPriority: Dispatch<SetStateAction<string>>;
  notes: string;
  setNotes: Dispatch<SetStateAction<string>>;
  systemUserGroups: SelectGroup[];
  participantDisplayItems: SelectItem[];
  selectedParticipants: SelectItem[];
  setSelectedParticipants: Dispatch<SetStateAction<SelectItem[]>>;
  notifyDisplayItems: SelectItem[];
  selectedNotifyUsers: SelectItem[];
  setSelectedNotifyUsers: Dispatch<SetStateAction<SelectItem[]>>;
  externalSearchRef: RefObject<HTMLDivElement | null>;
  selectedExternal: string[];
  setSelectedExternal: Dispatch<SetStateAction<string[]>>;
  externalSearch: string;
  setExternalSearch: Dispatch<SetStateAction<string>>;
  showExternalDropdown: boolean;
  setShowExternalDropdown: Dispatch<SetStateAction<boolean>>;
  filteredExternal: ExternalOption[];
  showAddExternal: boolean;
  setShowAddExternal: Dispatch<SetStateAction<boolean>>;
  newExternalName: string;
  setNewExternalName: Dispatch<SetStateAction<string>>;
  newExternalPhone: string;
  setNewExternalPhone: Dispatch<SetStateAction<string>>;
  newExternalCompany: string;
  setNewExternalCompany: Dispatch<SetStateAction<string>>;
  newExternalPosition: string;
  setNewExternalPosition: Dispatch<SetStateAction<string>>;
  addQuickExternal: () => void;
  meetingManager: string;
  setMeetingManager: Dispatch<SetStateAction<string>>;
  managerDisplayName: string;
  repeatEnabled: boolean;
  setRepeatEnabled: Dispatch<SetStateAction<boolean>>;
  repeatType: 'weekly' | 'monthly';
  setRepeatType: Dispatch<SetStateAction<'weekly' | 'monthly'>>;
  repeatInterval: number;
  setRepeatInterval: Dispatch<SetStateAction<number>>;
  repeatEndDate: string;
  setRepeatEndDate: Dispatch<SetStateAction<string>>;
  showEndDatePicker: boolean;
  setShowEndDatePicker: Dispatch<SetStateAction<boolean>>;
  endDatePickerJy: number;
  setEndDatePickerJy: Dispatch<SetStateAction<number>>;
  endDatePickerJm: number;
  setEndDatePickerJm: Dispatch<SetStateAction<number>>;
  repeatWeekday: number;
  setRepeatWeekday: Dispatch<SetStateAction<number>>;
  repeatMonthlyMode: 'specific' | 'nth';
  setRepeatMonthlyMode: Dispatch<SetStateAction<'specific' | 'nth'>>;
  repeatMonthlyNth: number;
  setRepeatMonthlyNth: Dispatch<SetStateAction<number>>;
  repeatMonthlyNthWeekday: number;
  setRepeatMonthlyNthWeekday: Dispatch<SetStateAction<number>>;
  reminderMinutes: number;
  setReminderMinutes: Dispatch<SetStateAction<number>>;
  agendaEnabled: boolean;
  setAgendaEnabled: Dispatch<SetStateAction<boolean>>;
  agendaItems: AgendaItem[];
  setAgendaItems: Dispatch<SetStateAction<AgendaItem[]>>;
  showAgendaForm: boolean;
  setShowAgendaForm: Dispatch<SetStateAction<boolean>>;
  agendaForm: { title: string; presenter: string; duration_minutes: string; description: string };
  setAgendaForm: Dispatch<SetStateAction<{ title: string; presenter: string; duration_minutes: string; description: string }>>;
  editingAgendaIdx: number | null;
  setEditingAgendaIdx: Dispatch<SetStateAction<number | null>>;
  prefillMeetingId: string | null;
  isOnline: boolean;
  setIsOnline: Dispatch<SetStateAction<boolean>>;
  sendSms: boolean;
  setSendSms: Dispatch<SetStateAction<boolean>>;
  saveContact: boolean;
  setSaveContact: Dispatch<SetStateAction<boolean>>;
  repFromContacts: boolean;
  loading: boolean;
  orgUsersLoading: boolean;
  committing: boolean;
  editDecision: null | { changeSet: MeetingChangeSet; snapshot: CommitSnapshot };
  setEditDecision: Dispatch<SetStateAction<null | { changeSet: MeetingChangeSet; snapshot: CommitSnapshot }>>;
  commitEdit: (snapshot: CommitSnapshot, notifyExistingParticipants: boolean) => void;
}

export function CalendarMeetingFormView({
  onSubmit,
  onCancel,
  calendars,
  selectedCalendarId,
  setSelectedCalendarId,
  selectedCalendar,
  membersOnly,
  setMembersOnly,
  scheduleDate,
  setScheduleDate,
  showManualDateTime,
  setShowManualDateTime,
  manualDateStr,
  setManualDateStr,
  manualStartTime,
  setManualStartTime,
  manualEndTime,
  setManualEndTime,
  startTime,
  setStartTime,
  endTime,
  setEndTime,
  subject,
  setSubject,
  location,
  setLocation,
  representative,
  setRepresentative,
  setRepFromContacts,
  repPickerRef,
  showRepPicker,
  setShowRepPicker,
  repPickerSearch,
  setRepPickerSearch,
  allContacts,
  phone,
  setPhone,
  priority,
  setPriority,
  notes,
  setNotes,
  systemUserGroups,
  participantDisplayItems,
  selectedParticipants,
  setSelectedParticipants,
  notifyDisplayItems,
  selectedNotifyUsers,
  setSelectedNotifyUsers,
  externalSearchRef,
  selectedExternal,
  setSelectedExternal,
  externalSearch,
  setExternalSearch,
  showExternalDropdown,
  setShowExternalDropdown,
  filteredExternal,
  showAddExternal,
  setShowAddExternal,
  newExternalName,
  setNewExternalName,
  newExternalPhone,
  setNewExternalPhone,
  newExternalCompany,
  setNewExternalCompany,
  newExternalPosition,
  setNewExternalPosition,
  addQuickExternal,
  meetingManager,
  setMeetingManager,
  managerDisplayName,
  repeatEnabled,
  setRepeatEnabled,
  repeatType,
  setRepeatType,
  repeatInterval,
  setRepeatInterval,
  repeatEndDate,
  setRepeatEndDate,
  showEndDatePicker,
  setShowEndDatePicker,
  endDatePickerJy,
  setEndDatePickerJy,
  endDatePickerJm,
  setEndDatePickerJm,
  repeatWeekday,
  setRepeatWeekday,
  repeatMonthlyMode,
  setRepeatMonthlyMode,
  repeatMonthlyNth,
  setRepeatMonthlyNth,
  repeatMonthlyNthWeekday,
  setRepeatMonthlyNthWeekday,
  reminderMinutes,
  setReminderMinutes,
  agendaEnabled,
  setAgendaEnabled,
  agendaItems,
  setAgendaItems,
  showAgendaForm,
  setShowAgendaForm,
  agendaForm,
  setAgendaForm,
  editingAgendaIdx,
  setEditingAgendaIdx,
  prefillMeetingId,
  isOnline,
  setIsOnline,
  sendSms,
  setSendSms,
  saveContact,
  setSaveContact,
  repFromContacts,
  loading,
  orgUsersLoading,
  committing,
  editDecision,
  setEditDecision,
  commitEdit,
}: CalendarMeetingFormViewProps) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col h-full" dir="rtl">
      <FormHeader onClose={onCancel} />

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <CalendarSelectorSection
          calendars={calendars}
          selectedCalendarId={selectedCalendarId}
          setSelectedCalendarId={setSelectedCalendarId}
          selectedCalendar={selectedCalendar}
          membersOnly={membersOnly}
          setMembersOnly={setMembersOnly}
        />

        <DateTimeSection
          scheduleDate={scheduleDate}
          showManualDateTime={showManualDateTime}
          setShowManualDateTime={setShowManualDateTime}
          manualDateStr={manualDateStr}
          setManualDateStr={setManualDateStr}
          manualStartTime={manualStartTime}
          setManualStartTime={setManualStartTime}
          manualEndTime={manualEndTime}
          setManualEndTime={setManualEndTime}
          startTime={startTime}
          setStartTime={setStartTime}
          endTime={endTime}
          setEndTime={setEndTime}
          setScheduleDate={setScheduleDate}
        />

        <CoreFieldsSection
          subject={subject}
          setSubject={setSubject}
          location={location}
          setLocation={setLocation}
          representative={representative}
          setRepresentative={setRepresentative}
          setRepFromContacts={setRepFromContacts}
          repPickerRef={repPickerRef}
          showRepPicker={showRepPicker}
          setShowRepPicker={setShowRepPicker}
          repPickerSearch={repPickerSearch}
          setRepPickerSearch={setRepPickerSearch}
          allContacts={allContacts}
          setPhone={setPhone}
          phone={phone}
          priority={priority}
          setPriority={setPriority}
          notes={notes}
          setNotes={setNotes}
        />

        <MultiSelectField
          label="شرکت‌کنندگان جلسه"
          icon={<Users className="w-4 h-4" />}
          placeholder="جستجوی کاربران..."
          options={[]}
          groups={systemUserGroups}
          selected={participantDisplayItems}
          onAdd={item => setSelectedParticipants(previous => previous.some(current => current.id === item.id) ? previous : [...previous, item])}
          onRemove={id => setSelectedParticipants(previous => previous.filter(item => item.id !== id))}
          tagColor="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
        />

        <MultiSelectField
          label="مطلعین جلسه"
          icon={<Bell className="w-4 h-4" />}
          placeholder="جستجوی کاربران..."
          options={[]}
          groups={systemUserGroups}
          selected={notifyDisplayItems}
          onAdd={item => setSelectedNotifyUsers(previous => previous.some(current => current.id === item.id) ? previous : [...previous, item])}
          onRemove={id => setSelectedNotifyUsers(previous => previous.filter(item => item.id !== id))}
          tagColor="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        />

        <ExternalParticipantsSection
          externalSearchRef={externalSearchRef}
          selectedExternal={selectedExternal}
          setSelectedExternal={setSelectedExternal}
          externalSearch={externalSearch}
          setExternalSearch={setExternalSearch}
          showExternalDropdown={showExternalDropdown}
          setShowExternalDropdown={setShowExternalDropdown}
          filteredExternal={filteredExternal}
          showAddExternal={showAddExternal}
          setShowAddExternal={setShowAddExternal}
          newExternalName={newExternalName}
          setNewExternalName={setNewExternalName}
          newExternalPhone={newExternalPhone}
          setNewExternalPhone={setNewExternalPhone}
          newExternalCompany={newExternalCompany}
          setNewExternalCompany={setNewExternalCompany}
          newExternalPosition={newExternalPosition}
          setNewExternalPosition={setNewExternalPosition}
          addQuickExternal={addQuickExternal}
        />

        <MeetingManagerSection
          selectedParticipants={selectedParticipants}
          meetingManager={meetingManager}
          setMeetingManager={setMeetingManager}
          participantDisplayItems={participantDisplayItems}
          managerDisplayName={managerDisplayName}
        />

        <RepeatSection
          repeatEnabled={repeatEnabled}
          setRepeatEnabled={setRepeatEnabled}
          repeatType={repeatType}
          setRepeatType={setRepeatType}
          repeatInterval={repeatInterval}
          setRepeatInterval={setRepeatInterval}
          repeatEndDate={repeatEndDate}
          setRepeatEndDate={setRepeatEndDate}
          showEndDatePicker={showEndDatePicker}
          setShowEndDatePicker={setShowEndDatePicker}
          endDatePickerJy={endDatePickerJy}
          setEndDatePickerJy={setEndDatePickerJy}
          endDatePickerJm={endDatePickerJm}
          setEndDatePickerJm={setEndDatePickerJm}
          repeatWeekday={repeatWeekday}
          setRepeatWeekday={setRepeatWeekday}
          repeatMonthlyMode={repeatMonthlyMode}
          setRepeatMonthlyMode={setRepeatMonthlyMode}
          repeatMonthlyNth={repeatMonthlyNth}
          setRepeatMonthlyNth={setRepeatMonthlyNth}
          repeatMonthlyNthWeekday={repeatMonthlyNthWeekday}
          setRepeatMonthlyNthWeekday={setRepeatMonthlyNthWeekday}
          scheduleDate={scheduleDate}
        />

        <ReminderSection reminderMinutes={reminderMinutes} setReminderMinutes={setReminderMinutes} />

        <AgendaSection
          agendaEnabled={agendaEnabled}
          setAgendaEnabled={setAgendaEnabled}
          agendaItems={agendaItems}
          setAgendaItems={setAgendaItems}
          showAgendaForm={showAgendaForm}
          setShowAgendaForm={setShowAgendaForm}
          agendaForm={agendaForm}
          setAgendaForm={setAgendaForm}
          editingAgendaIdx={editingAgendaIdx}
          setEditingAgendaIdx={setEditingAgendaIdx}
          participantDisplayItems={participantDisplayItems}
          selectedExternal={selectedExternal}
          prefillMeetingId={prefillMeetingId}
        />

        <OnlineMeetingSection isOnline={isOnline} setIsOnline={setIsOnline} />

        <SmsOptionsSection
          sendSms={sendSms}
          setSendSms={setSendSms}
          saveContact={saveContact}
          setSaveContact={setSaveContact}
          repFromContacts={repFromContacts}
          representative={representative}
        />
      </div>

      <FormFooter
        loading={loading}
        orgUsersLoading={orgUsersLoading}
        committing={committing}
        editDecision={editDecision}
        onCancel={onCancel}
      />

      {editDecision && (
        <EditDecisionModal
          changeSet={editDecision.changeSet}
          snapshot={editDecision.snapshot}
          committing={committing}
          onCommitWithNotify={commitEdit}
          onCommitWithoutNotify={commitEdit}
          onCancel={() => setEditDecision(null)}
        />
      )}
    </form>
  );
}
