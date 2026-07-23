import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { logAudit } from '../../../lib/audit';
import { CirclePlus as PlusCircle, Loader as Loader2, Save, X, Bell, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';
import { ContactEmail } from '../../../types';
import type { AgendaItem } from '../../../types';
import { useOrgUsers } from '../../../lib/useOrgUsers';
import { MeetingFormAuthFallback } from './CreateMeetingForm/MeetingFormAuthFallback';
import { RepresentativeContactField } from './CreateMeetingForm/RepresentativeContactField';
import { ExternalParticipantsField } from './CreateMeetingForm/ExternalParticipantsField';
import { AgendaEditor } from './CreateMeetingForm/AgendaEditor';
import { RecurrenceFields } from './CreateMeetingForm/RecurrenceFields';
import { MeetingCoreFields } from './CreateMeetingForm/MeetingCoreFields';
import { MeetingPeopleFields } from './CreateMeetingForm/MeetingPeopleFields';

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
          const { data: mtg } = await supabase.from('meetings').select('participant_user_ids, notify_users, external_participants').eq('id', prefillData.meetingId!).maybeSingle();
          if (mtg?.participant_user_ids?.length) {
            setSelectedParticipants(resolveUsersByIds(mtg.participant_user_ids));
          }
          if (mtg?.notify_users?.length) {
            setSelectedNotifyUsers(resolveUsersByIds(mtg.notify_users));
          }
          if (mtg?.external_participants?.length) {
            setSelectedExternal(mtg.external_participants);
          }
        })();
      }
      // Load agenda items when editing an existing meeting
      if (prefillData.meetingId) {
        (async () => {
          const { data: items } = await supabase
            .from('meeting_agenda_items')
            .select('*')
            .eq('meeting_id', prefillData.meetingId!)
            .order('sort_order');
          if (items && items.length > 0) {
            setAgendaEnabled(true);
            setAgendaItems(items.map((it: any) => ({
              title: it.title,
              presenter: it.presenter,
              duration_minutes: it.duration_minutes,
              sort_order: it.sort_order,
            })));
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
      const { data, error } = await supabase.from('contacts_email').select('*').eq('user_id', uid).order('name');
      if (error) throw error;
      setContacts(data || []);
      setAllContacts(data || []);
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

      const meetingRecord: any = {
        subject, request_date: gregDate, request_jalaali_date: requestJalaaliDate,
        request_duration: requestDuration,
        duration: isSchedulingFromCalendar && startTime && endTime ? `${startTime} - ${endTime}` : requestDuration,
        location, representative, phone, notes: notes || null, priority,
        status: isSchedulingFromCalendar ? 'closed' : 'open',
        status_type: statusType, user_id: userId,
        notify_users: Array.from(new Set([userId, ...selectedNotifyUsers.map(u => u.id)])),
        participant_user_ids: selectedParticipants.map(p => p.id),
        external_participants: selectedExternal,
        repeat_type: repeatEnabled ? repeatType : 'none',
        repeat_interval: repeatEnabled ? repeatInterval : null,
        repeat_end_date: repeatEnabled ? repeatEndDate : null,
        repeat_weekday: repeatEnabled && repeatType === 'weekly' ? repeatWeekday : null,
        reminder_minutes: reminderMinutes || null,
        send_sms: false, meeting_manager: meetingManager || null,
        calendar_id: selectedCalendarId || null,
      };

      if (startTime && endTime) {
        meetingRecord.start_time = startTime;
        meetingRecord.end_time = endTime;
      }

      if (prefillMeetingId) {
        const { error } = await supabase.from('meetings').update(meetingRecord).eq('id', prefillMeetingId);
        if (error) throw error;

        if (agendaEnabled) {
          await supabase.from('meeting_agenda_items').delete().eq('meeting_id', prefillMeetingId);
          if (agendaItems.length > 0) {
            await supabase.from('meeting_agenda_items').insert(
              agendaItems.map((item, i) => ({ ...item, meeting_id: prefillMeetingId, sort_order: i }))
            );
          }
        }

        logAudit({ module: 'meetings', action: 'meeting_updated', entity_name: subject, entity_id: prefillMeetingId, details: `جلسه "${subject}" ویرایش شد`, severity: 'info' });

        toast.success('جلسه ویرایش شد');
      } else {
        const { data: meetingData, error: meetingError } = await supabase.from('meetings').insert([meetingRecord]).select().single();
        if (meetingError) throw meetingError;

        if (selectedParticipants.length > 0 && meetingData) {
          await supabase.from('participants').insert(selectedParticipants.map(p => ({ meeting_id: meetingData.id, name: p.name })));
        }

        if (repeatEnabled && meetingData && repeatEndDate) {
          await createRepeatMeetings(meetingData.id, meetingRecord);
        }

        if (agendaEnabled && agendaItems.length > 0 && meetingData) {
          await supabase.from('meeting_agenda_items').insert(
            agendaItems.map((item, i) => ({ ...item, meeting_id: meetingData.id, sort_order: i }))
          );
        }

        logAudit({ module: 'meetings', action: 'meeting_created', entity_name: subject, entity_id: meetingData?.id, details: `جلسه جدید "${subject}" ثبت شد`, severity: 'info' });

        toast.success('درخواست جلسه ثبت شد');
      }

      // Save contact only when manually entered (not from contacts list)
      if (saveContact && !repFromContacts && representative.trim() && userId) {
        await supabase.from('contacts_email').insert([{ name: representative, phone, email: '', user_id: userId }]);
      }

      resetForm();
      onSuccess(subject, !!prefillMeetingId);
    } catch (error: any) { console.error('Error:', error); toast.error(error.message || 'خطا در ثبت جلسه'); }
    finally { setLoading(false); }
  };

  // ---- Repeat meeting creation (fixed) ----
  const createRepeatMeetings = async (_originalId: string, baseRecord: any) => {
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
    const { id: _rid, ...baseWithoutId } = baseRecord;
    const repeatMeetings: any[] = [];

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
      const { error: repeatError } = await supabase.from('meetings').insert(repeatMeetings);
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
      const { data, error } = await supabase.from('contacts_email').insert([{ name: newExternalName, email: newExternalEmail, phone: newExternalPhone, user_id: userId }]).select().single();
      if (error) throw error;
      if (data) { setContacts(prev => [...prev, data]); setSelectedExternal(prev => [...prev, newExternalName]); }
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

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اولویت</label>
          <select value={priority} onChange={(e) => setPriority(e.target.value)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
            <option value="high">بالا</option>
            <option value="medium">متوسط</option>
            <option value="low">پایین</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">وضعیت</label>
          <select value={statusType} onChange={(e) => setStatusType(e.target.value)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
            <option value="requested">درخواست شده</option>
            <option value="approved">تایید شده</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">یادداشت‌ها</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
        </div>
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
      {selectedParticipants.length > 0 && (
        <div className="mt-5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <div className="flex items-center gap-2"><UserCheck className="w-4 h-4" /> مدیر جلسه</div>
          </label>
          <select value={meetingManager} onChange={(e) => setMeetingManager(e.target.value)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
            <option value="">بدون مدیر</option>
            {selectedParticipants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <p className="text-xs text-gray-400 mt-1">مدیر جلسه می‌تواند تمام تغییرات جلسه را اعمال کند</p>
        </div>
      )}

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
      <div className="mt-5">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          <div className="flex items-center gap-2"><Bell className="w-4 h-4" /> یادآوری</div>
        </label>
        <select value={reminderMinutes} onChange={(e) => setReminderMinutes(Number(e.target.value))}
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
          <option value={0}>بدون یادآوری</option>
          <option value={5}>5 دقیقه قبل</option>
          <option value={10}>10 دقیقه قبل</option>
          <option value={15}>15 دقیقه قبل</option>
          <option value={30}>30 دقیقه قبل</option>
          <option value={60}>1 ساعت قبل</option>
          <option value={1440}>1 روز قبل</option>
        </select>
      </div>

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

      {/* Save contact — only show when rep was entered manually */}      {!repFromContacts && representative.trim() && (
        <div className="mt-4 flex items-center gap-2">
          <input type="checkbox" id="saveContact" checked={saveContact} onChange={(e) => setSaveContact(e.target.checked)} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
          <label htmlFor="saveContact" className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Save className="w-4 h-4" /> ذخیره اطلاعات تماس در دفترچه
          </label>
        </div>
      )}

      {/* Submit */}
      <div className="mt-6 flex gap-3">
        <button type="submit" disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 bg-blue-500 text-white py-2.5 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50 font-medium">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlusCircle className="w-5 h-5" />}
          {prefillMeetingId ? 'ذخیره تغییرات' : isSchedulingFromCalendar ? 'برنامه‌ریزی و ثبت نهایی' : 'ثبت درخواست جلسه'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}
            className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 font-medium transition-colors">
            انصراف
          </button>
        )}
      </div>
    </form>
  );
}
