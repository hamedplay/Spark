import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { PlusCircle, Loader2, Mail, Lock, UserPlus, Save, Users, X, Plus, Bell, Repeat, UserCheck, Clock, Calendar, ChevronLeft, ChevronRight, BookUser, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';
import { ContactEmail } from '../types';
import { useOrgUsers } from '../lib/useOrgUsers';

// Tags-inside-input multi-select
function MultiSelectField({
  label, icon, placeholder, options, groups, selected, onAdd, onRemove, tagColor,
}: {
  label: string; icon: React.ReactNode; placeholder: string;
  options: { id: string; name: string; sub?: string }[];
  groups?: { label: string; options: { id: string; name: string; sub?: string }[] }[];
  selected: { id: string; name: string }[];
  onAdd: (item: { id: string; name: string }) => void;
  onRemove: (id: string) => void;
  tagColor: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Flatten all group options for search/filter
  const allOptions = groups ? groups.flatMap(g => g.options) : options;

  const filtered = allOptions.filter(o =>
    !selected.find(s => s.id === o.id) &&
    (o.name.toLowerCase().includes(query.toLowerCase()) || (o.sub || '').toLowerCase().includes(query.toLowerCase()))
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length === 1) { onAdd({ id: filtered[0].id, name: filtered[0].name }); setQuery(''); setOpen(false); }
    }
  };

  const isSearching = query.trim().length > 0;

  return (
    <div ref={ref}>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{icon}{label}</label>
      <div className="flex flex-wrap gap-1.5 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 cursor-text min-h-[42px]"
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        {selected.map(s => (
          <span key={s.id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${tagColor}`}>
            {s.name}
            <button type="button" onClick={ev => { ev.stopPropagation(); onRemove(s.id); }} className="hover:opacity-70"><X className="w-3 h-3" /></button>
          </span>
        ))}
        <input ref={inputRef} type="text" value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] outline-none bg-transparent text-sm dark:text-white placeholder-gray-400" />
      </div>
      {open && (isSearching ? filtered.length > 0 : (groups ? groups.some(g => g.options.some(o => !selected.find(s => s.id === o.id))) : filtered.length > 0)) && (
        <div className="relative z-20">
          <div className="absolute w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-52 overflow-y-auto">
            {isSearching ? (
              // حالت جستجو — لیست مسطح
              filtered.length === 0
                ? <div className="p-3 text-sm text-gray-400">کاربری یافت نشد</div>
                : filtered.map(o => (
                  <button key={o.id} type="button"
                    onClick={() => { onAdd({ id: o.id, name: o.name }); setQuery(''); setOpen(false); }}
                    className="w-full text-right px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0">
                    <span>{o.name}</span>
                    {o.sub && <span className="text-xs text-gray-400 truncate mr-2 max-w-[160px]">{o.sub}</span>}
                  </button>
                ))
            ) : groups ? (
              // حالت گروه‌بندی واحد سازمانی
              groups.map(group => {
                const groupItems = group.options.filter(o => !selected.find(s => s.id === o.id));
                if (groupItems.length === 0) return null;
                return (
                  <div key={group.label}>
                    <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide bg-gray-50 dark:bg-gray-800 sticky top-0">
                      {group.label}
                    </div>
                    {groupItems.map(o => (
                      <button key={o.id} type="button"
                        onClick={() => { onAdd({ id: o.id, name: o.name }); setQuery(''); setOpen(false); }}
                        className="w-full text-right px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0">
                        <span>{o.name}</span>
                        {o.sub && <span className="text-xs text-gray-400 truncate mr-2 max-w-[160px]">{o.sub}</span>}
                      </button>
                    ))}
                  </div>
                );
              })
            ) : (
              // حالت قدیمی — لیست مسطح
              filtered.length === 0
                ? <div className="p-3 text-sm text-gray-400">کاربری یافت نشد</div>
                : filtered.slice(0, 8).map(o => (
                  <button key={o.id} type="button"
                    onClick={() => { onAdd({ id: o.id, name: o.name }); setQuery(''); setOpen(false); }}
                    className="w-full text-right px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0">
                    <span>{o.name}</span>
                    {o.sub && <span className="text-xs text-gray-400">{o.sub}</span>}
                  </button>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
  const { groups: orgGroups } = useOrgUsers(userId);

  const systemUserGroups = orgGroups.map(g => ({
    label: g.unit_name,
    options: g.users.map(u => ({ id: u.user_id, name: u.full_name || u.email || '', sub: u.position_title || '' })),
  }));

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
  const [showRepPicker, setShowRepPicker] = useState(false);
  const [repPickerSearch, setRepPickerSearch] = useState('');
  const repPickerRef = useRef<HTMLDivElement>(null);

  // Participants (system users)
  const [systemUsers, setSystemUsers] = useState<{ id: string; full_name: string; email: string }[]>([]);
  const [selectedParticipants, setSelectedParticipants] = useState<{ id: string; name: string }[]>([]);

  // Notify users
  const [selectedNotifyUsers, setSelectedNotifyUsers] = useState<{ id: string; name: string }[]>([]);

  // External participants
  const [contacts, setContacts] = useState<ContactEmail[]>([]);
  const [externalSearch, setExternalSearch] = useState('');
  const [selectedExternal, setSelectedExternal] = useState<string[]>([]);
  const [showExternalDropdown, setShowExternalDropdown] = useState(false);
  const [newExternalName, setNewExternalName] = useState('');
  const [newExternalEmail, setNewExternalEmail] = useState('');
  const [newExternalPhone, setNewExternalPhone] = useState('');
  const [showAddExternal, setShowAddExternal] = useState(false);
  const externalSearchRef = useRef<HTMLDivElement>(null);

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

  // Meeting manager
  const [meetingManager, setMeetingManager] = useState<string>('');

  // Inline Jalali date picker state
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerJy, setDatePickerJy] = useState(() => moment().jYear());
  const [datePickerJm, setDatePickerJm] = useState(() => moment().jMonth() + 1);
  const datePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDatePicker) return;
    const h = (e: MouseEvent) => { if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) setShowDatePicker(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showDatePicker]);

  // Calendar scheduling
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [scheduleDate, setScheduleDate] = useState<{ jy: number; jm: number; jd: number } | null>(null);
  const [isSchedulingFromCalendar, setIsSchedulingFromCalendar] = useState(false);
  const [prefillMeetingId, setPrefillMeetingId] = useState<string | null>(null);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('');
  const [userDisplayName, setUserDisplayName] = useState('');

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) { setUserId(user.id); setShowAuthError(false); fetchSystemUsers(user.id); fetchContacts(user.id); }
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
      // Load participants from prefill IDs
      if (prefillData.participantUserIds && prefillData.participantUserIds.length > 0) {
        (async () => {
          const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', prefillData.participantUserIds!);
          if (profiles) {
            setSelectedParticipants(profiles.map((p: any) => ({ id: p.user_id, name: p.full_name || p.email || p.user_id })));
          }
        })();
      }
      // Load participants from existing meeting record (when scheduling from pending)
      if (prefillData.meetingId && (!prefillData.participantUserIds || prefillData.participantUserIds.length === 0)) {
        (async () => {
          const { data: mtg } = await supabase.from('meetings').select('participant_user_ids').eq('id', prefillData.meetingId!).maybeSingle();
          if (mtg?.participant_user_ids?.length) {
            const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', mtg.participant_user_ids);
            if (profiles) {
              setSelectedParticipants(profiles.map((p: any) => ({ id: p.user_id, name: p.full_name || p.email || p.user_id })));
            }
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

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (externalSearchRef.current && !externalSearchRef.current.contains(e.target as Node)) setShowExternalDropdown(false);
      if (repPickerRef.current && !repPickerRef.current.contains(e.target as Node)) setShowRepPicker(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchSystemUsers = async (currentUserId?: string) => {
    try {
      const { data, error } = await supabase.from('profiles').select('user_id, full_name, email').not('is_hidden', 'eq', true).order('full_name');
      if (error) throw error;
      const users = (data || []).map((p: any) => ({ id: p.user_id, full_name: p.full_name || p.email, email: p.email }));
      setSystemUsers(users);
      if (currentUserId) {
        const me = users.find(u => u.id === currentUserId);
        if (me) setUserDisplayName(me.full_name);
      }
    } catch (error) { console.error('Error fetching users:', error); }
  };

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
  const createRepeatMeetings = async (originalId: string, baseRecord: any) => {
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

  // ---- Search filters ----
  const filteredContacts = contacts.filter(c =>
    c.name.toLowerCase().includes(externalSearch.toLowerCase()) ||
    (c.email ?? '').toLowerCase().includes(externalSearch.toLowerCase())
  ).filter(c => !selectedExternal.includes(c.name));

  const systemUserOptions = systemUsers.map(u => ({ id: u.id, name: u.full_name, sub: u.email }));

  const filteredRepContacts = allContacts.filter(c =>
    c.name.toLowerCase().includes(repPickerSearch.toLowerCase()) ||
    (c.phone || '').includes(repPickerSearch)
  );

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
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
        <div className="text-center">
          <h2 className="text-xl font-bold text-gray-800 dark:text-white mb-6">{isSignUp ? 'ایجاد حساب کاربری' : 'ورود به سیستم'}</h2>
          <form onSubmit={isSignUp ? handleSignUp : handleLogin} className="space-y-4">
            <div>
              <label className="block text-right text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ایمیل</label>
              <div className="relative">
                <input type="email" value={authForm.email} onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
                  className="w-full p-2 pl-10 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" required />
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              </div>
            </div>
            <div>
              <label className="block text-right text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رمز عبور</label>
              <div className="relative">
                <input type="password" value={authForm.password} onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                  className="w-full p-2 pl-10 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" required minLength={6} />
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
              </div>
            </div>
            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : isSignUp ? <><UserPlus className="w-5 h-5" />ایجاد حساب</> : <><Mail className="w-5 h-5" />ورود</>}
            </button>
          </form>
          <button onClick={() => setIsSignUp(!isSignUp)} className="mt-4 text-blue-500 hover:text-blue-600">
            {isSignUp ? 'حساب دارید؟ وارد شوید' : 'حساب ندارید؟ ثبت‌نام'}
          </button>
        </div>
      </div>
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
          // Edit mode — full-width section with vertically stacked date + time fields
          <div className="md:col-span-2">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4" />تاریخ و زمان جلسه
            </p>
            <div className="space-y-3">
              {/* Row 1 — Date picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ (شمسی)</label>
                <div className="relative" ref={datePickerRef}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!showDatePicker && requestJalaaliDate) {
                        const parts = requestJalaaliDate.split('/').map(Number);
                        if (parts.length === 3 && parts[0] > 1300) { setDatePickerJy(parts[0]); setDatePickerJm(parts[1]); }
                      }
                      setShowDatePicker(v => !v);
                    }}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-right flex items-center justify-between hover:border-blue-400 transition-colors"
                  >
                    <span className={requestJalaaliDate ? 'text-gray-900 dark:text-white' : 'text-gray-400'}>
                      {requestJalaaliDate || 'انتخاب تاریخ...'}
                    </span>
                    <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
                  </button>
                  {showDatePicker && (
                    <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-600 p-3 w-64">
                      <div className="flex items-center justify-between mb-2">
                        <button type="button" onClick={() => { if (datePickerJm > 1) setDatePickerJm(m => m - 1); else { setDatePickerJm(12); setDatePickerJy(y => y - 1); } }}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ChevronRight className="w-4 h-4 dark:text-white" /></button>
                        <span className="text-sm font-semibold dark:text-white">{JALAALI_MONTHS[datePickerJm - 1]} {datePickerJy}</span>
                        <button type="button" onClick={() => { if (datePickerJm < 12) setDatePickerJm(m => m + 1); else { setDatePickerJm(1); setDatePickerJy(y => y + 1); } }}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ChevronLeft className="w-4 h-4 dark:text-white" /></button>
                      </div>
                      <div className="grid grid-cols-7 gap-0.5">
                        {['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map(d => <div key={d} className="text-center text-[10px] text-gray-400 py-0.5">{d}</div>)}
                        {(() => {
                          const daysInMonth = datePickerJm <= 6 ? 31 : datePickerJm <= 11 ? 30 : 29;
                          const firstDay = moment(`${datePickerJy}/${datePickerJm}/1`, 'jYYYY/jM/jD').day();
                          const offset = firstDay === 6 ? 0 : firstDay + 1;
                          const cells: React.ReactNode[] = [];
                          for (let i = 0; i < offset; i++) cells.push(<div key={`e${i}`} />);
                          for (let d = 1; d <= daysInMonth; d++) {
                            const jDate = `${datePickerJy}/${String(datePickerJm).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
                            const isSelected = requestJalaaliDate === jDate;
                            cells.push(
                              <button key={d} type="button" onClick={() => { setRequestJalaaliDate(jDate); setShowDatePicker(false); }}
                                className={`text-xs py-1 rounded transition-colors ${isSelected ? 'bg-blue-500 text-white' : 'hover:bg-blue-100 dark:hover:bg-blue-900/30 dark:text-white'}`}>{d}</button>
                            );
                          }
                          return cells;
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* Row 2 — Start time */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ساعت شروع</label>
                <div className="relative">
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
              {/* Row 3 — End time */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ساعت پایان</label>
                <div className="relative">
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>
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

        {/* Representative with contact picker */}
        <div className="relative" ref={repPickerRef}>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نماینده</label>
          <div className="flex gap-2">
            <input required type="text" value={representative}
              onChange={(e) => { setRepresentative(e.target.value); setRepFromContacts(false); }}
              className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
            <button type="button" onClick={() => { setShowRepPicker(v => !v); setRepPickerSearch(''); }}
              className="px-2.5 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              title="انتخاب از مخاطبین">
              <BookUser className="w-4 h-4" />
            </button>
          </div>
          {showRepPicker && (
            <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl">
              <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                <input autoFocus type="text" value={repPickerSearch} onChange={e => setRepPickerSearch(e.target.value)}
                  placeholder="جستجو در مخاطبین..." className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="max-h-48 overflow-y-auto">
                {filteredRepContacts.length === 0 ? (
                  <div className="p-3 text-sm text-gray-400 text-center">مخاطبی یافت نشد</div>
                ) : filteredRepContacts.map(c => (
                  <button key={c.id} type="button"
                    onClick={() => {
                      setRepresentative(c.name);
                      setPhone((c as any).phone || '');
                      setRepFromContacts(true);
                      setShowRepPicker(false);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-colors">
                    <span className="font-medium dark:text-white">{c.name}</span>
                    {(c as any).phone && <span className="text-xs text-gray-400 ltr">{(c as any).phone}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شماره تماس</label>
          <input required type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setRepFromContacts(false); }}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
        </div>

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
      <div className="mt-5" ref={externalSearchRef}>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
          <UserPlus className="w-4 h-4" />افراد خارج سازمان
        </label>
        <div
          className="flex flex-wrap gap-1.5 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 cursor-text min-h-[42px]"
          onClick={() => setShowExternalDropdown(true)}
        >
          {selectedExternal.map(name => (
            <span key={name} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
              {name}
              <button type="button" onClick={e => { e.stopPropagation(); setSelectedExternal(p => p.filter(x => x !== name)); }} className="hover:opacity-70">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={externalSearch}
            onChange={e => { setExternalSearch(e.target.value); setShowExternalDropdown(true); }}
            onFocus={() => setShowExternalDropdown(true)}
            placeholder={selectedExternal.length === 0 ? 'جستجوی مخاطبین خارج سازمان...' : ''}
            className="flex-1 min-w-[120px] outline-none bg-transparent text-sm dark:text-white placeholder-gray-400"
          />
        </div>
        {showExternalDropdown && (
          <div className="relative z-20">
            <div className="absolute w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-44 overflow-y-auto">
              {filteredContacts.slice(0, 8).map(c => (
                <button key={c.id} type="button"
                  onClick={() => { setSelectedExternal(p => [...p, c.name]); setExternalSearch(''); setShowExternalDropdown(false); }}
                  className="w-full text-right px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0">
                  <span>{c.name}</span><span className="text-xs text-gray-400">{c.email}</span>
                </button>
              ))}
              {(externalSearch || filteredContacts.length === 0) && (
                <button type="button" onClick={() => { setShowAddExternal(true); setShowExternalDropdown(false); }}
                  className="w-full text-right px-3 py-2 hover:bg-green-50 dark:hover:bg-green-900/20 text-sm text-green-600 flex items-center gap-2 border-t border-gray-200 dark:border-gray-600">
                  <Plus className="w-4 h-4" />افزودن مخاطب جدید
                </button>
              )}
              {filteredContacts.length === 0 && !externalSearch && (
                <div className="p-3 text-sm text-gray-400">مخاطبی یافت نشد</div>
              )}
            </div>
          </div>
        )}
        {showAddExternal && (
          <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
            <div className="space-y-2 mb-2">
              <input type="text" value={newExternalName} onChange={(e) => setNewExternalName(e.target.value)}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="نام مخاطب" />
              <div className="flex gap-2">
                <input type="tel" value={newExternalPhone} onChange={(e) => setNewExternalPhone(e.target.value)}
                  className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="شماره موبایل" />
                <input type="email" value={newExternalEmail} onChange={(e) => setNewExternalEmail(e.target.value)}
                  className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="ایمیل (اختیاری)" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={addQuickExternal} className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600">ذخیره و افزودن</button>
              <button type="button" onClick={() => { setShowAddExternal(false); setNewExternalName(''); setNewExternalEmail(''); setNewExternalPhone(''); }} className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300">انصراف</button>
            </div>
          </div>
        )}
      </div>

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

      {/* Save contact — only show when rep was entered manually */}
      {!repFromContacts && representative.trim() && (
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
