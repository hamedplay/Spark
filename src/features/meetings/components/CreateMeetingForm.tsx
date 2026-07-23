import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { logAudit } from '../../../lib/audit';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';
import { ContactEmail } from '../../../types';
import type { AgendaItem } from '../../../types';
import { useOrgUsers } from '../../../lib/useOrgUsers';
import {
  fetchMeetingContacts,
  createExternalMeetingContact,
  saveRepresentativeMeetingContact,
} from '../repositories/meetingContactsRepository';
import {
  fetchMeetingAgendaItems,
  insertMeetingAgendaItems,
  replaceMeetingAgendaItems,
} from '../repositories/meetingAgendaRepository';
import { fetchMeetingPeoplePrefill } from '../repositories/meetingPrefillRepository';
import {
  createPrimaryMeeting,
  insertRecurringMeetingBatch,
  updatePrimaryMeeting,
} from '../repositories/meetingPersistenceRepository';
import { buildMeetingPersistenceRecord } from '../builders/buildMeetingPersistenceRecord';
import type {
  MeetingPersistenceRecord,
} from '../types/meetingPersistence';
import { insertMeetingParticipantSnapshots } from '../repositories/meetingParticipantsRepository';
import { MeetingFormAuthFallback } from './CreateMeetingForm/MeetingFormAuthFallback';
import { RepresentativeContactField } from './CreateMeetingForm/RepresentativeContactField';
import { ExternalParticipantsField } from './CreateMeetingForm/ExternalParticipantsField';
import { AgendaEditor } from './CreateMeetingForm/AgendaEditor';
import { RecurrenceFields } from './CreateMeetingForm/RecurrenceFields';
import { MeetingCoreFields } from './CreateMeetingForm/MeetingCoreFields';
import { MeetingPeopleFields } from './CreateMeetingForm/MeetingPeopleFields';
import { MeetingMetadataFields } from './CreateMeetingForm/MeetingMetadataFields';
import { MeetingManagerField } from './CreateMeetingForm/MeetingManagerField';
import { MeetingReminderField } from './CreateMeetingForm/MeetingReminderField';
import { MeetingFormActions } from './CreateMeetingForm/MeetingFormActions';

interface CalendarEntry {
  id: string;
  name: string;
  color: string;
  type: 'private' | 'public' | 'shared';
}

interface CreateMeetingFormProps {
  onSuccess: (subject?: string, isUpdate?: boolean) => void;
  onCancel?: () => void;
  calendars?: CalendarEntry[];
  prefillData?: {
    subject?: string;
    location?: string;
    representative?: string;
    phone?: string;
    notes?: string;
    priority?: string;
    meetingId?: string;
    startTime?: string;
    endTime?: string;
    dateJy?: number;
    dateJm?: number;
    dateJd?: number;
    participantUserIds?: string[];
    requestJalaaliDate?: string;
  } | null;
}

export function CreateMeetingForm({ onSuccess, onCancel, prefillData, calendars = [] }: CreateMeetingFormProps) {
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  // گروه‌بندی کاربران بر اساس واحد سازمانی
  const { groups: orgGroups, allUsers } = useOrgUsers(userId);

  const systemUserGroups = orgGroups.map(g => ({
    label: g.unit_name,
    options: g.users.map(u => {
      const subs: string[] = [];
      if (u.position_title) subs.push(u.position_title);
      const others = u.assignments.filter(a => a.positionTitle && a.positionTitle !== u.position_title);
      if (others.length) subs.push(others.map(a => a.positionTitle).join('، '));
      return { id: u.user_id, name: u.full_name || '', sub: subs.join(' · ') };
    }),
  }));

  // تبدیل user_id به نام نمایشی بر اساس داده‌های useOrgUsers (بدون query مستقیم profiles)
  const resolveUserName = (uid: string): string =>
    allUsers.find(u => u.user_id === uid)?.full_name || 'کاربر سیستم';
  const resolveUsersByIds = (ids: string[]): { id: string; name: string }[] =>
    ids.map(id => ({ id, name: resolveUserName(id) }));

  const [showAuthError, setShowAuthError] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [authForm, setAuthForm] = useState({ email: '', password: '' });

  const [subject, setSubject] = useState('');
  const [requestDuration, setRequestDuration] = useState('1 ساعت');
  const [requestJalaaliDate, setRequestJalaaliDate] = useState('');
  const [location, setLocation] = useState('');
  const [representative, setRepresentative] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('medium');
  const [statusType, setStatusType] = useState('requested');
  const [saveContact, setSaveContact] = useState(false);
  // true when rep+phone were loaded from contacts (hide save checkbox)
  const [repFromContacts, setRepFromContacts] = useState(false);

  // Contact picker for representative
  const [allContacts, setAllContacts] = useState<ContactEmail[]>([]);

  // Participants (system users)
  const [selectedParticipants, setSelectedParticipants] = useState<{ id: string; name: string }[]>([]);

  // Notify users
  const [selectedNotifyUsers, setSelectedNotifyUsers] = useState<{ id: string; name: string }[]>([]);

  // External participants
  const [contacts, setContacts] = useState<ContactEmail[]>([]);
  const [selectedExternal, setSelectedExternal] = useState<string[]>([]);
  const [newExternalName, setNewExternalName] = useState('');
  const [newExternalEmail, setNewExternalEmail] = useState('');
  const [newExternalPhone, setNewExternalPhone] = useState('');
  const [showAddExternal, setShowAddExternal] = useState(false);

  // Repeat
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatType, setRepeatType] = useState<'weekly' | 'monthly'>('weekly');
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [repeatEndDate, setRepeatEndDate] = useState('');
  const [repeatWeekday, setRepeatWeekday] = useState(0);
  const [repeatMonthlyMode, setRepeatMonthlyMode] = useState<'specific' | 'first' | 'last'>('specific');
  const [repeatMonthlyWeekday, setRepeatMonthlyWeekday] = useState(0);

  // Reminder
  const [reminderMinutes, setReminderMinutes] = useState<number>(15);

  // Agenda
  const [agendaEnabled, setAgendaEnabled] = useState(false);
  const [agendaItems, setAgendaItems] = useState<Omit<AgendaItem, 'id' | 'meeting_id' | 'created_at'>[]>([]);

  // Meeting manager
  const [meetingManager, setMeetingManager] = useState<string>('');

  // Calendar scheduling
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [scheduleDate, setScheduleDate] = useState<{ jy: number; jm: number; jd: number } | null>(null);
  const [isSchedulingFromCalendar, setIsSchedulingFromCalendar] = useState(false);
  const [prefillMeetingId, setPrefillMeetingId] = useState<string | null>(null);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) { setUserId(user.id); setShowAuthError(false); fetchContacts(user.id); }
      else { setShowAuthError(true); }
    };
    getUser();
  }, []);

  useEffect(() => {
    if (prefillData) {
      setSubject(prefillData.subject || '');
      setLocation(prefillData.location || '');
      setRepresentative(prefillData.representative || '');
      setPhone(prefillData.phone || '');
      setNotes(prefillData.notes || '');
      setPriority(prefillData.priority || 'medium');
      setStartTime(prefillData.startTime || '');
      setEndTime(prefillData.endTime || '');
      if (prefillData.requestJalaaliDate) {
        setRequestJalaaliDate(prefillData.requestJalaaliDate);
      }
      if (prefillData.dateJy && prefillData.dateJm && prefillData.dateJd) {
        setScheduleDate({ jy: prefillData.dateJy, jm: prefillData.dateJm, jd: prefillData.dateJd });
      }
      if (prefillData.meetingId) { setPrefillMeetingId(prefillData.meetingId); }
      // Only treat as calendar scheduling when a specific date was passed (drag from calendar cell)
      if (prefillData.dateJy && prefillData.dateJm && prefillData.dateJd) { setIsSchedulingFromCalendar(true); }
      if (prefillData.startTime && prefillData.endTime) {
        const [sh, sm] = prefillData.startTime.split(':').map(Number);
        const [eh, em] = prefillData.endTime.split(':').map(Number);
        const diffMin = (eh * 60 + em) - (sh * 60 + sm);
        if (diffMin <= 30) setRequestDuration('30 دقیقه');
        else if (diffMin <= 45) setRequestDuration('45 دقیقه');
        else if (diffMin <= 60) setRequestDuration('1 ساعت');
        else if (diffMin <= 90) setRequestDuration('1.5 ساعت');
        else if (diffMin <= 120) setRequestDuration('2 ساعت');
        else if (diffMin <= 180) setRequestDuration('3 ساعت');
        else if (diffMin <= 360) setRequestDuration('نیم روز');
        else setRequestDuration('یک روز');
      }
      // Load participants from prefill IDs (name resolution via useOrgUsers data)
      if (prefillData.participantUserIds && prefillData.participantUserIds.length > 0) {
        setSelectedParticipants(resolveUsersByIds(prefillData.participantUserIds));
      }
      // Load participants, notify users and external participants from existing meeting record (when scheduling from pending)
      if (prefillData.meetingId && (!prefillData.participantUserIds || prefillData.participantUserIds.length === 0)) {
        (async () => {
          try {
            const peoplePrefill = await fetchMeetingPeoplePrefill(prefillData.meetingId);
            if (peoplePrefill?.participantUserIds?.length) {
              setSelectedParticipants(resolveUsersByIds(peoplePrefill.participantUserIds));
            }
            if (peoplePrefill?.notifyUserIds?.length) {
              setSelectedNotifyUsers(resolveUsersByIds(peoplePrefill.notifyUserIds));
            }
            if (peoplePrefill?.externalParticipants?.length) {
              setSelectedExternal(peoplePrefill.externalParticipants);
            }
          } catch {
            return;
          }
        })();
      }
      // Load agenda items when editing an existing meeting
      if (prefillData.meetingId) {
        (async () => {
          const items = await fetchMeetingAgendaItems(prefillData.meetingId!);
          if (items.length > 0) {
            setAgendaEnabled(true);
            setAgendaItems(items);
          }
        })();
      }
    }
  }, [prefillData]);

  useEffect(() => {
    if (!requestJalaaliDate) {
      const m = moment();
      setRequestJalaaliDate(`${m.jYear()}/${String(m.jMonth() + 1).padStart(2, '0')}/${String(m.jDate()).padStart(2, '0')}`);
    }
  }, []);

  // No-op: user list now sourced from useOrgUsers (secure RPC). Kept for call-site stability.
  const fetchSystemUsers = async (_currentUserId?: string) => {};

  const fetchContacts = async (uid: string) => {
    try {
      const data = await fetchMeetingContacts(uid);
      setContacts(data);
      setAllContacts(data);
    } catch (error) { console.error('Error fetching contacts:', error); }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: authForm.email, password: authForm.password, options: { emailRedirectTo: window.location.origin } });
      if (error) throw error;
      if (data.user) { setUserId(data.user.id); setShowAuthError(false); toast.success('حساب کاربری ایجاد شد'); }
    } catch (error: any) { toast.error(error.message === 'User already registered' ? 'این ایمیل قبلاً ثبت شده' : 'خطا در ایجاد حساب'); }
    finally { setLoading(false); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: authForm.email, password: authForm.password });
      if (error) throw error;
      if (data.user) { setUserId(data.user.id); setShowAuthError(false); toast.success('وارد شدید'); }
    } catch (error: any) { toast.error(error.message === 'Invalid login credentials' ? 'ایمیل یا رمز اشتباه' : 'خطا در ورود'); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) { toast.error('لطفا وارد شوید'); return; }
    if (!subject.trim()) { toast.error('موضوع جلسه را وارد کنید'); return; }

    setLoading(true);
    try {
      let gregDate: string;
      if (isSchedulingFromCalendar && scheduleDate) {
        const m = moment(`${scheduleDate.jy}/${scheduleDate.jm}/${scheduleDate.jd}`, 'jYYYY/jM/jD');
        gregDate = m.toDate().toISOString();
      } else if (requestJalaaliDate) {
        const m = moment(requestJalaaliDate, 'jYYYY/jMM/jDD');
        if (!m.isValid()) { toast.error('تاریخ شمسی نامعتبر'); setLoading(false); return; }
        gregDate = m.toDate().toISOString();
      } else { toast.error('تاریخ درخواست را وارد کنید'); setLoading(false); return; }

      const meetingRecord = buildMeetingPersistenceRecord({
        subject,

        gregorianRequestDate: gregDate,
        requestJalaaliDate,
        requestDuration,

        location,
        representative,
        phone,
        notes,

        priority,
        statusType,
        userId,

        notifyUserIds:
          selectedNotifyUsers.map(
            (user) => user.id
          ),

        participantUserIds:
          selectedParticipants.map(
            (participant) => participant.id
          ),

        externalParticipants:
          selectedExternal,

        repeatEnabled,
        repeatType,
        repeatInterval,
        repeatEndDate,
        repeatWeekday,

        reminderMinutes,
        meetingManager,
        calendarId: selectedCalendarId,

        isSchedulingFromCalendar,
        startTime,
        endTime,
      });

      if (prefillMeetingId) {
        await updatePrimaryMeeting(prefillMeetingId, meetingRecord);

        if (agendaEnabled) {
          await replaceMeetingAgendaItems(prefillMeetingId, agendaItems);
        }

        logAudit({ module: 'meetings', action: 'meeting_updated', entity_name: subject, entity_id: prefillMeetingId, details: `جلسه "${subject}" ویرایش شد`, severity: 'info' });

        toast.success('جلسه ویرایش شد');
      } else {
        const meetingData = await createPrimaryMeeting(meetingRecord);

        if (selectedParticipants.length > 0 && meetingData) {
          await insertMeetingParticipantSnapshots(
            meetingData.id,
            selectedParticipants
          );
        }

        if (repeatEnabled && meetingData && repeatEndDate) {
          await createRepeatMeetings(meetingData.id, meetingRecord);
        }

        if (agendaEnabled && agendaItems.length > 0 && meetingData) {
          await insertMeetingAgendaItems(meetingData.id, agendaItems);
        }

        logAudit({ module: 'meetings', action: 'meeting_created', entity_name: subject, entity_id: meetingData?.id, details: `جلسه جدید "${subject}" ثبت شد`, severity: 'info' });

        toast.success('درخواست جلسه ثبت شد');
      }

      // Save contact only when manually entered (not from contacts list)
      if (saveContact && !repFromContacts && representative.trim() && userId) {
        await saveRepresentativeMeetingContact({ userId, name: representative, phone, email: '' });
      }

      resetForm();
      onSuccess(subject, !!prefillMeetingId);
    } catch (error: any) { console.error('Error:', error); toast.error(error.message || 'خطا در ثبت جلسه'); }
    finally { setLoading(false); }
  };

  // ---- Repeat meeting creation (fixed) ----
  type RepeatBaseRecord =
    MeetingPersistenceRecord & {
      id?: string;
    };

  const createRepeatMeetings = async (
    _originalId: string,
    baseRecord: RepeatBaseRecord
  ) => {
    const type = repeatType;
    const interval = repeatInterval;
    const endDate = repeatEndDate;

    let endMs: number;
    if (endDate.includes('/') && endDate.split('/').length === 3) {
      const [jy, jm, jd] = endDate.split('/').map(Number);
      const gregDate = moment(`${jy}/${jm}/${jd}`, 'jYYYY/jM/jD').toDate();
      gregDate.setHours(23, 59, 59, 999);
      endMs = gregDate.getTime();
    } else {
      endMs = new Date(endDate).getTime();
    }
    if (isNaN(endMs)) return;

    const baseDate = new Date(baseRecord.request_date);
    const {
      id: ignoredRecordId,
      ...baseWithoutId
    } = baseRecord;
    void ignoredRecordId;
    const repeatMeetings: MeetingPersistenceRecord[] = [];

    if (type === 'weekly') {
      // targetDay: 0=شنبه(Sat), 1=یکشنبه(Sun), ... 6=جمعه(Fri)
      // JS getDay(): 0=Sun,1=Mon,...,6=Sat
      const jsDayMap = [6, 0, 1, 2, 3, 4, 5]; // index=our weekday, value=JS day
      const targetJsDay = jsDayMap[repeatWeekday];

      // Find the first occurrence of targetJsDay strictly after baseDate
      let currentDate = new Date(baseDate);
      currentDate.setDate(currentDate.getDate() + 1); // at least one day after base
      const diff = (targetJsDay - currentDate.getDay() + 7) % 7;
      currentDate.setDate(currentDate.getDate() + diff);

      while (currentDate.getTime() <= endMs) {
        const jDate = moment(currentDate).format('jYYYY/jMM/jDD');
        repeatMeetings.push({ ...baseWithoutId, request_date: currentDate.toISOString(), request_jalaali_date: jDate, status: 'open' });
        currentDate = new Date(currentDate.getTime() + 7 * interval * 86400000);
      }
    } else if (type === 'monthly') {
      const jsDayMap = [6, 0, 1, 2, 3, 4, 5];

      if (repeatMonthlyMode === 'specific') {
        // Same Gregorian day-of-month, every `interval` months
        let y = baseDate.getFullYear();
        let mo = baseDate.getMonth() + interval;
        const day = baseDate.getDate();

        while (true) {
          const d = new Date(y, mo, day);
          if (d.getTime() > endMs) break;
          if (d.getTime() > baseDate.getTime()) {
            const jDate = moment(d).format('jYYYY/jMM/jDD');
            repeatMeetings.push({ ...baseWithoutId, request_date: d.toISOString(), request_jalaali_date: jDate, status: 'open' });
          }
          mo += interval;
          if (mo >= 12) { y += Math.floor(mo / 12); mo = mo % 12; }
        }
      } else {
        // First or last specific weekday of month
        const targetJsDay = jsDayMap[repeatMonthlyWeekday];
        let y = baseDate.getFullYear();
        let mo = baseDate.getMonth() + interval;

        while (true) {
          if (mo >= 12) { y += Math.floor(mo / 12); mo = mo % 12; }
          let targetDate: Date;
          if (repeatMonthlyMode === 'first') {
            targetDate = new Date(y, mo, 1);
            while (targetDate.getDay() !== targetJsDay) targetDate.setDate(targetDate.getDate() + 1);
          } else {
            targetDate = new Date(y, mo + 1, 0);
            while (targetDate.getDay() !== targetJsDay) targetDate.setDate(targetDate.getDate() - 1);
          }
          if (targetDate.getTime() > endMs) break;
          if (targetDate.getTime() > baseDate.getTime()) {
            const jDate = moment(targetDate).format('jYYYY/jMM/jDD');
            repeatMeetings.push({ ...baseWithoutId, request_date: targetDate.toISOString(), request_jalaali_date: jDate, status: 'open' });
          }
          mo += interval;
        }
      }
    }

    if (repeatMeetings.length > 0) {
      const repeatError = await insertRecurringMeetingBatch(repeatMeetings);
      if (repeatError) { console.error('Repeat insert error:', repeatError); toast.error('خطا در ایجاد جلسات تکراری: ' + repeatError.message); }
      else toast.success(`${repeatMeetings.length} جلسه تکراری ایجاد شد`);
    }
  };

  const resetForm = () => {
    setSubject(''); setRequestDuration('1 ساعت'); setLocation(''); setRepresentative('');
    setPhone(''); setNotes(''); setPriority('medium'); setStatusType('requested'); setSaveContact(false);
    setRepFromContacts(false);
    setSelectedParticipants([]); setSelectedNotifyUsers([]); setSelectedExternal([]);
    setRepeatEnabled(false); setRepeatType('weekly'); setRepeatInterval(1); setRepeatEndDate('');
    setRepeatWeekday(0); setRepeatMonthlyMode('specific'); setRepeatMonthlyWeekday(0);
    setReminderMinutes(15); setMeetingManager('');
    setStartTime(''); setEndTime(''); setScheduleDate(null);
    setIsSchedulingFromCalendar(false); setPrefillMeetingId(null);
    setSelectedCalendarId('');
    const m = moment();
    setRequestJalaaliDate(`${m.jYear()}/${String(m.jMonth() + 1).padStart(2, '0')}/${String(m.jDate()).padStart(2, '0')}`);
  };

  const addQuickExternal = async () => {
    if (!newExternalName.trim() || !userId) return;
    try {
      const data = await createExternalMeetingContact({ userId, name: newExternalName, email: newExternalEmail, phone: newExternalPhone });
      setContacts(prev => [...prev, data]); setSelectedExternal(prev => [...prev, newExternalName]);
      setNewExternalName(''); setNewExternalEmail(''); setNewExternalPhone(''); setShowAddExternal(false);
      toast.success('مخاطب اضافه شد');
    } catch { toast.error('خطا در افزودن مخاطب'); }
  };


  if (showAuthError) {
    return (
      <MeetingFormAuthFallback
        isSignUp={isSignUp}
        email={authForm.email}
        password={authForm.password}
        loading={loading}
        onSubmit={isSignUp ? handleSignUp : handleLogin}
        onEmailChange={(value) =>
          setAuthForm({ ...authForm, email: value })
        }
        onPasswordChange={(value) =>
          setAuthForm({ ...authForm, password: value })
        }
        onToggleMode={() => setIsSignUp(!isSignUp)}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold dark:text-white">
          {prefillMeetingId ? 'ویرایش جلسه' : isSchedulingFromCalendar ? 'تنظیم جلسه' : 'درخواست جلسه جدید'}
        </h2>
        {onCancel && (
          <button type="button" onClick={onCancel} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <MeetingCoreFields
          subject={subject}
          onSubjectChange={setSubject}

          calendars={calendars}
          selectedCalendarId={selectedCalendarId}
          onSelectedCalendarIdChange={setSelectedCalendarId}

          prefillMeetingId={prefillMeetingId}
          isSchedulingFromCalendar={isSchedulingFromCalendar}
          scheduleDate={scheduleDate}

          startTime={startTime}
          onStartTimeChange={setStartTime}
          endTime={endTime}
          onEndTimeChange={setEndTime}

          requestJalaaliDate={requestJalaaliDate}
          onRequestJalaaliDateChange={setRequestJalaaliDate}

          requestDuration={requestDuration}
          onRequestDurationChange={setRequestDuration}

          location={location}
          onLocationChange={setLocation}
        />

        <RepresentativeContactField
          representative={representative}
          phone={phone}
          contacts={allContacts}
          onRepresentativeChange={(value) => {
            setRepresentative(value);
            setRepFromContacts(false);
          }}
          onPhoneChange={(value) => {
            setPhone(value);
            setRepFromContacts(false);
          }}
          onSelectContact={(contact) => {
            setRepresentative(contact.name);
            setPhone(contact.phone ?? '');
            setRepFromContacts(true);
          }}
        />

        <MeetingMetadataFields
          priority={priority}
          statusType={statusType}
          notes={notes}
          onPriorityChange={setPriority}
          onStatusTypeChange={setStatusType}
          onNotesChange={setNotes}
        />
      </div>

      {/* Participants & Notify Users */}
      <MeetingPeopleFields
        groups={systemUserGroups}
        participants={selectedParticipants}
        notifyUsers={selectedNotifyUsers}
        onParticipantsChange={setSelectedParticipants}
        onNotifyUsersChange={setSelectedNotifyUsers}
      />

      {/* External Participants */}
      <ExternalParticipantsField
        contacts={contacts}
        selectedNames={selectedExternal}
        draft={{
          name: newExternalName,
          email: newExternalEmail,
          phone: newExternalPhone,
        }}
        isAddFormOpen={showAddExternal}
        onSelect={(name) =>
          setSelectedExternal((current) => [...current, name])
        }
        onRemove={(name) =>
          setSelectedExternal((current) =>
            current.filter((item) => item !== name)
          )
        }
        onDraftChange={(draft) => {
          setNewExternalName(draft.name);
          setNewExternalEmail(draft.email);
          setNewExternalPhone(draft.phone);
        }}
        onAddFormOpenChange={setShowAddExternal}
        onAddContact={addQuickExternal}
      />

      {/* Meeting Manager */}
      <MeetingManagerField
        participants={selectedParticipants}
        managerId={meetingManager}
        onManagerChange={setMeetingManager}
      />

      {/* Repeat */}
      <RecurrenceFields
        enabled={repeatEnabled}
        type={repeatType}
        interval={repeatInterval}
        endDate={repeatEndDate}
        weekday={repeatWeekday}
        monthlyMode={repeatMonthlyMode}
        monthlyWeekday={repeatMonthlyWeekday}
        onEnabledChange={setRepeatEnabled}
        onTypeChange={setRepeatType}
        onIntervalChange={setRepeatInterval}
        onEndDateChange={setRepeatEndDate}
        onWeekdayChange={setRepeatWeekday}
        onMonthlyModeChange={setRepeatMonthlyMode}
        onMonthlyWeekdayChange={setRepeatMonthlyWeekday}
      />

      {/* Reminder */}
      <MeetingReminderField
        minutes={reminderMinutes}
        onMinutesChange={setReminderMinutes}
      />

      {/* Agenda */}
      <AgendaEditor
        enabled={agendaEnabled}
        items={agendaItems}
        participantNames={selectedParticipants.map(p => p.name)}
        externalNames={selectedExternal}
        onEnabledChange={setAgendaEnabled}
        onItemsChange={setAgendaItems}
        onValidationError={(message) => toast.error(message)}
      />

      <MeetingFormActions
        showSaveContact={!repFromContacts && representative.trim() !== ''}
        saveContact={saveContact}
        loading={loading}
        submitLabel={prefillMeetingId ? 'ذخیره تغییرات' : isSchedulingFromCalendar ? 'برنامه‌ریزی و ثبت نهایی' : 'ثبت درخواست جلسه'}
        onSaveContactChange={setSaveContact}
      >
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 font-medium transition-colors">
            انصراف
          </button>
        )}
      </MeetingFormActions>
    </form>
  );
}
