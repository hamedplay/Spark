import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { logAudit } from '../../../lib/audit';
import { CirclePlus as PlusCircle, Loader as Loader2, Save, Users, X, Plus, Bell, Repeat, UserCheck, Clock, Calendar, ChevronLeft, ChevronRight, ClipboardList, Pencil, Trash2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';
import { ContactEmail } from '../../../types';
import type { AgendaItem } from '../../../types';
import { useOrgUsers } from '../../../lib/useOrgUsers';
import { MultiSelectField } from './CreateMeetingForm/MultiSelectField';
import { MeetingDateTimeFields } from './CreateMeetingForm/MeetingDateTimeFields';
import { MeetingFormAuthFallback } from './CreateMeetingForm/MeetingFormAuthFallback';
import { RepresentativeContactField } from './CreateMeetingForm/RepresentativeContactField';
import { ExternalParticipantsField } from './CreateMeetingForm/ExternalParticipantsField';

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

const JALAALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

const JALAALI_WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

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
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [endDatePickerJy, setEndDatePickerJy] = useState(() => moment().jYear());
  const [endDatePickerJm, setEndDatePickerJm] = useState(() => moment().jMonth() + 1);

  // Reminder
  const [reminderMinutes, setReminderMinutes] = useState<number>(15);

  // Agenda
  const [agendaEnabled, setAgendaEnabled] = useState(false);
  const [agendaItems, setAgendaItems] = useState<Omit<AgendaItem, 'id' | 'meeting_id' | 'created_at'>[]>([]);
  const [showAgendaForm, setShowAgendaForm] = useState(false);
  const [agendaForm, setAgendaForm] = useState({ title: '', presenter: '', duration_minutes: '' });
  const [editingAgendaIdx, setEditingAgendaIdx] = useState<number | null>(null);

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
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">موضوع جلسه</label>
          <input required type="text" value={subject} onChange={(e) => setSubject(e.target.value)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
        </div>

        {calendars.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تقویم جلسه</label>
            <div className="relative">
              <select value={selectedCalendarId} onChange={(e) => setSelectedCalendarId(e.target.value)}
                className="w-full p-2 pr-8 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white appearance-none">
                <option value="">بدون تقویم</option>
                {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {selectedCalendarId && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full" style={{ backgroundColor: calendars.find(c => c.id === selectedCalendarId)?.color || '#3b82f6' }} />
              )}
            </div>
          </div>
        )}

        {isSchedulingFromCalendar && scheduleDate && startTime && endTime ? (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ جلسه</label>
              <div className="p-2 border border-teal-300 dark:border-teal-600 rounded-lg bg-teal-50 dark:bg-teal-900/20 text-teal-800 dark:text-teal-300 font-medium text-sm">
                {scheduleDate.jd} {JALAALI_MONTHS[scheduleDate.jm - 1]} {scheduleDate.jy}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">زمان جلسه</label>
              <div className="flex items-center gap-2 p-2 border border-teal-300 dark:border-teal-600 rounded-lg bg-teal-50 dark:bg-teal-900/20 text-teal-800 dark:text-teal-300 font-medium text-sm">
                <Clock className="w-4 h-4 shrink-0" />
                <span>{startTime}</span><span className="text-teal-500">تا</span><span>{endTime}</span>
              </div>
            </div>
          </>
        ) : prefillMeetingId ? (
          <MeetingDateTimeFields
            requestJalaaliDate={requestJalaaliDate}
            onRequestJalaaliDateChange={setRequestJalaaliDate}
            startTime={startTime}
            onStartTimeChange={setStartTime}
            endTime={endTime}
            onEndTimeChange={setEndTime}
          />
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ درخواست (شمسی)</label>
              <div className="relative">
                <input type="text" value={requestJalaaliDate} onChange={(e) => setRequestJalaaliDate(e.target.value)}
                  placeholder="1405/03/01" className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                  disabled={isSchedulingFromCalendar} />
                <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">مدت زمان درخواستی</label>
              <select value={requestDuration} onChange={(e) => setRequestDuration(e.target.value)}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
                <option value="30 دقیقه">30 دقیقه</option>
                <option value="45 دقیقه">45 دقیقه</option>
                <option value="1 ساعت">1 ساعت</option>
                <option value="1.5 ساعت">1.5 ساعت</option>
                <option value="2 ساعت">2 ساعت</option>
                <option value="3 ساعت">3 ساعت</option>
                <option value="نیم روز">نیم روز</option>
                <option value="یک روز">یک روز</option>
              </select>
            </div>
          </>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">محل برگزاری</label>
          <input required type="text" value={location} onChange={(e) => setLocation(e.target.value)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
        </div>

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

      {/* Participants */}
      <div className="mt-6">
        <MultiSelectField
          label="شرکت‌کنندگان جلسه"
          icon={<Users className="w-4 h-4" />}
          placeholder="جستجوی کاربران سامانه..."
          options={[]}
          groups={systemUserGroups}
          selected={selectedParticipants}
          onAdd={item => setSelectedParticipants(p => [...p, item])}
          onRemove={id => setSelectedParticipants(p => p.filter(x => x.id !== id))}
          tagColor="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
        />
      </div>

      {/* Notify Users */}
      <div className="mt-5">
        <MultiSelectField
          label="مطلعین جلسه"
          icon={<Bell className="w-4 h-4" />}
          placeholder="جستجوی کاربران برای اطلاع‌رسانی..."
          options={[]}
          groups={systemUserGroups}
          selected={selectedNotifyUsers}
          onAdd={item => setSelectedNotifyUsers(p => [...p, item])}
          onRemove={id => setSelectedNotifyUsers(p => p.filter(x => x.id !== id))}
          tagColor="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        />
      </div>

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
      <div className="mt-5 p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-600">
        <div className="flex items-center gap-2 mb-3">
          <input type="checkbox" id="repeatToggle" checked={repeatEnabled} onChange={(e) => setRepeatEnabled(e.target.checked)} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
          <label htmlFor="repeatToggle" className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <Repeat className="w-4 h-4" /> تکرار جلسه
          </label>
        </div>
        {repeatEnabled && (
          <div className="space-y-3 mt-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">نوع تکرار</label>
                <select value={repeatType} onChange={(e) => setRepeatType(e.target.value as 'weekly' | 'monthly')}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
                  <option value="weekly">هفتگی</option><option value="monthly">ماهیانه</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">هر چند</label>
                <select value={repeatInterval} onChange={(e) => setRepeatInterval(Number(e.target.value))}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
                  {[1, 2, 3, 4].map(n => <option key={n} value={n}>هر {n} {repeatType === 'weekly' ? 'هفته' : 'ماه'}</option>)}
                </select>
              </div>
              <div className="relative">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">تا تاریخ (شمسی)</label>
                <div className="flex gap-1">
                  <input type="text" value={repeatEndDate} onChange={(e) => setRepeatEndDate(e.target.value)} placeholder="مثال: 1405/06/31"
                    className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                  <button type="button" onClick={() => setShowEndDatePicker(!showEndDatePicker)}
                    className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                    <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  </button>
                </div>
                {showEndDatePicker && (
                  <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-600 p-3 w-64">
                    <div className="flex items-center justify-between mb-2">
                      <button type="button" onClick={() => { if (endDatePickerJm > 1) setEndDatePickerJm(m => m - 1); else { setEndDatePickerJm(12); setEndDatePickerJy(y => y - 1); } }}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                        <ChevronRight className="w-4 h-4 dark:text-white" />
                      </button>
                      <span className="text-sm font-semibold dark:text-white">{JALAALI_MONTHS[endDatePickerJm - 1]} {endDatePickerJy}</span>
                      <button type="button" onClick={() => { if (endDatePickerJm < 12) setEndDatePickerJm(m => m + 1); else { setEndDatePickerJm(1); setEndDatePickerJy(y => y + 1); } }}
                        className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                        <ChevronLeft className="w-4 h-4 dark:text-white" />
                      </button>
                    </div>
                    <div className="grid grid-cols-7 gap-0.5">
                      {['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map(d => <div key={d} className="text-center text-[10px] text-gray-400 py-0.5">{d}</div>)}
                      {(() => {
                        const daysInMonth = endDatePickerJm <= 6 ? 31 : endDatePickerJm <= 11 ? 30 : 29;
                        const firstDay = moment(`${endDatePickerJy}/${endDatePickerJm}/1`, 'jYYYY/jM/jD').day();
                        const offset = firstDay === 6 ? 0 : firstDay + 1;
                        const cells: React.ReactNode[] = [];
                        for (let i = 0; i < offset; i++) cells.push(<div key={`e${i}`} />);
                        for (let d = 1; d <= daysInMonth; d++) {
                          const jDate = `${endDatePickerJy}/${String(endDatePickerJm).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
                          cells.push(
                            <button key={d} type="button" onClick={() => { setRepeatEndDate(jDate); setShowEndDatePicker(false); }}
                              className={`text-xs py-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors ${repeatEndDate === jDate ? 'bg-blue-500 text-white' : 'dark:text-white'}`}>
                              {d}
                            </button>
                          );
                        }
                        return cells;
                      })()}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {repeatType === 'weekly' && (
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">روز هفته</label>
                <div className="flex flex-wrap gap-1.5">
                  {JALAALI_WEEKDAYS.map((day, i) => (
                    <button key={i} type="button" onClick={() => setRepeatWeekday(i)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${repeatWeekday === i ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500'}`}>
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {repeatType === 'monthly' && (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">نوع تکرار ماهیانه</label>
                  <div className="flex gap-2">
                    {[{ value: 'specific', label: 'همان روز ماه' }, { value: 'first', label: 'اولین' }, { value: 'last', label: 'آخرین' }].map(opt => (
                      <button key={opt.value} type="button" onClick={() => setRepeatMonthlyMode(opt.value as any)}
                        className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${repeatMonthlyMode === opt.value ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'}`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {(repeatMonthlyMode === 'first' || repeatMonthlyMode === 'last') && (
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      {repeatMonthlyMode === 'first' ? 'اولین' : 'آخرین'} روز هفته
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {JALAALI_WEEKDAYS.map((day, i) => (
                        <button key={i} type="button" onClick={() => setRepeatMonthlyWeekday(i)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${repeatMonthlyWeekday === i ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'}`}>
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

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
      <div className="mt-5 p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-600">
        <div className="flex items-center gap-2 mb-3">
          <input
            type="checkbox"
            id="agendaToggle"
            checked={agendaEnabled}
            onChange={(e) => setAgendaEnabled(e.target.checked)}
            className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
          />
          <label htmlFor="agendaToggle" className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
            <ClipboardList className="w-4 h-4" /> دستور جلسه
          </label>
        </div>

        {agendaEnabled && (
          <div className="space-y-3 mt-3">
            {/* Existing items */}
            {agendaItems.length > 0 && (
              <div className="space-y-2">
                {agendaItems.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 p-2.5 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 text-sm">
                    <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-xs flex items-center justify-center font-bold flex-shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-800 dark:text-white truncate">{item.title}</p>
                      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex-wrap">
                        {item.presenter && <span className="flex items-center gap-1"><UserCheck className="w-3 h-3" />{item.presenter}</span>}
                        {item.duration_minutes != null && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{item.duration_minutes} دقیقه</span>}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAgendaForm({ title: item.title, presenter: item.presenter || '', duration_minutes: item.duration_minutes != null ? String(item.duration_minutes) : '' });
                        setEditingAgendaIdx(idx);
                        setShowAgendaForm(true);
                      }}
                      className="p-1 text-gray-400 hover:text-amber-500 transition-colors"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setAgendaItems(prev => prev.filter((_, i) => i !== idx))}
                      className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add item form */}
            {showAgendaForm ? (
              <div className="p-3 bg-white dark:bg-gray-700 rounded-lg border border-blue-200 dark:border-blue-700 space-y-3">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">عنوان دستور جلسه <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={agendaForm.title}
                    onChange={e => setAgendaForm(f => ({ ...f, title: e.target.value }))}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-800 dark:text-white text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    placeholder="مثال: بررسی گزارش مالی"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">ارائه‌دهنده</label>
                    <select
                      value={agendaForm.presenter}
                      onChange={e => setAgendaForm(f => ({ ...f, presenter: e.target.value }))}
                      className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-800 dark:text-white text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    >
                      <option value="">انتخاب ارائه‌دهنده...</option>
                      {selectedParticipants.length > 0 && (
                        <optgroup label="شرکت‌کنندگان سازمان">
                          {selectedParticipants.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                        </optgroup>
                      )}
                      {selectedExternal.length > 0 && (
                        <optgroup label="افراد خارج سازمان">
                          {selectedExternal.map(name => <option key={name} value={name}>{name}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">مدت زمان (دقیقه)</label>
                    <input
                      type="number"
                      min="1"
                      max="480"
                      value={agendaForm.duration_minutes}
                      onChange={e => setAgendaForm(f => ({ ...f, duration_minutes: e.target.value }))}
                      className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-800 dark:text-white text-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                      placeholder="مثال: 20"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!agendaForm.title.trim()) { toast.error('عنوان دستور جلسه را وارد کنید'); return; }
                      const newItem = {
                        title: agendaForm.title.trim(),
                        presenter: agendaForm.presenter.trim() || null,
                        duration_minutes: agendaForm.duration_minutes ? parseInt(agendaForm.duration_minutes, 10) : null,
                        sort_order: 0,
                      };
                      if (editingAgendaIdx !== null) {
                        setAgendaItems(prev => prev.map((it, i) => i === editingAgendaIdx ? newItem : it));
                        setEditingAgendaIdx(null);
                      } else {
                        setAgendaItems(prev => [...prev, newItem]);
                      }
                      setAgendaForm({ title: '', presenter: '', duration_minutes: '' });
                      setShowAgendaForm(false);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {editingAgendaIdx !== null ? 'ذخیره ویرایش' : 'افزودن دستور جلسه'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowAgendaForm(false); setEditingAgendaIdx(null); setAgendaForm({ title: '', presenter: '', duration_minutes: '' }); }}
                    className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
                  >
                    انصراف
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => { setShowAgendaForm(true); setEditingAgendaIdx(null); setAgendaForm({ title: '', presenter: '', duration_minutes: '' }); }}
                className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 dark:text-blue-400 border border-dashed border-blue-300 dark:border-blue-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors w-full justify-center"
              >
                <Plus className="w-4 h-4" /> ایجاد دستور جلسه
              </button>
            )}
          </div>
        )}
      </div>

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
