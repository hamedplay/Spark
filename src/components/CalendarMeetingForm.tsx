import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { insertNotification, getSmsTemplates, fillPlaceholders } from '../lib/notifications';
import type { SmsDispatchResult } from '../lib/notifications';
import { getMeetingTemplateKey, type MeetingRecipientRole, type MeetingAction } from '../config/templateCatalog';
import { CirclePlus as PlusCircle, Loader as Loader2, UserPlus, Bell, Repeat, MessageSquare, UserCheck, Clock, Calendar, ChevronLeft, ChevronRight, X, Plus, Users, Video, BookUser, Save, CreditCard as Edit2, Building2, ChevronDown, ClipboardList, Pencil, Trash2, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';
import { ContactEmail, AgendaItem } from '../types';
import { useOrgUsers } from '../lib/useOrgUsers';

interface ExternalSmsResult {
  ok: boolean;
  sent: number;
  skipped: number;
  error?: string;
}

async function sendSmsToExternals(
  externalNames: string[],
  allContacts: ContactEmail[],
  message: string,
  triggeredByUserId?: string | null,
  placeholders?: Record<string, string>,
): Promise<ExternalSmsResult> {
  if (!externalNames.length) return { ok: true, sent: 0, skipped: 0 };

  const resolved = externalNames
    .map(name => ({ name, contact: allContacts.find(c => c.name === name) }))
    .filter((r): r is { name: string; contact: ContactEmail } => !!r.contact && !!((r.contact as any).phone))
    .filter(r => ((r.contact as any).phone as string).trim().length >= 7);

  const mobiles = resolved.map(r => (r.contact as any).phone as string);
  const skippedNoPhone = externalNames.length - resolved.length;

  if (!mobiles.length) {
    return { ok: false, sent: 0, skipped: skippedNoPhone, error: 'شماره موبایل برای افراد خارج سازمان یافت نشد' };
  }

  // Apply SMS template for external contacts if available
  let smsMessage = message;
  if (placeholders) {
    const smsTemplates = await getSmsTemplates();
    const templateBody =
      smsTemplates.get('meeting:invite:external') ||
      smsTemplates.get('meeting:invite:all');
    if (templateBody) {
      smsMessage = fillPlaceholders(templateBody, placeholders);
    }
  }

  try {
    const { data: result, error: fnError } = await supabase.functions.invoke('send-sms', {
      body: {
        mode: 'external',
        mobiles,
        message: smsMessage,
        triggeredByUserId: triggeredByUserId ?? null,
        category: 'meeting',
        eventType: 'invite',
      },
    });

    if (fnError) throw new Error(fnError.message ?? String(fnError));

    return {
      ok: result?.ok === true,
      sent: result?.sent ?? 0,
      skipped: (result?.skipped ?? 0) + skippedNoPhone,
      error: result?.ok ? undefined : (result?.error ?? 'خطای ناشناخته'),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, sent: 0, skipped: skippedNoPhone, error: msg };
  }
}

/**
 * Collects SMS results for all recipients and shows a single, human-readable summary toast.
 * Meeting save is never rolled back regardless of SMS outcome.
 */
function showSmsSummary(
  internalResults: SmsDispatchResult[],
  externalResult: ExternalSmsResult | null,
) {
  const sent = internalResults.filter(r => r.status === 'sent').length
    + (externalResult?.sent ?? 0);
  const skipped = internalResults.filter(r => r.status === 'skipped').length
    + (externalResult?.skipped ?? 0);
  const failed = internalResults.filter(r => r.status === 'failed').length
    + (externalResult && !externalResult.ok && externalResult.sent === 0 ? 1 : 0);

  if (sent === 0 && skipped === 0 && failed === 0) return;

  const parts: string[] = [];
  if (sent > 0)    parts.push(`پیامک ${sent} نفر ارسال شد`);
  if (skipped > 0) parts.push(`${skipped} نفر پیامک ندارند یا قانونی برایشان تعریف نشده`);
  if (failed > 0)  parts.push(`ارسال برای ${failed} نفر ناموفق بود`);

  if (failed > 0) {
    toast.error('جلسه ثبت شد. ' + parts.join(' — '), { duration: 6000 });
  } else {
    toast.success('جلسه ثبت شد. ' + parts.join(' — '), { duration: 5000 });
  }
}


interface CalendarEntry {
  id: string;
  name: string;
  color: string;
  type: 'private' | 'public' | 'shared';
  user_id?: string;
  is_occasions?: boolean;
  is_personal_public?: boolean;
}

interface CalendarMeetingFormProps {
  onSuccess: (subject?: string, isUpdate?: boolean) => void;
  onCancel: () => void;
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
    calendarId?: string;
    membersOnly?: boolean;
    participantUserIds?: string[];
    repeatEnabled?: boolean;
    repeatType?: 'weekly' | 'monthly';
    repeatInterval?: number;
    repeatEndDate?: string;
    repeatWeekday?: number;
    editAllIds?: string[];
  } | null;
}

const JALAALI_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const JALAALI_WEEKDAYS = ['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنج‌شنبه','جمعه'];

// Multi-select input that shows selected items as tags inside the input box
function MultiSelectField({
  label, icon, placeholder, options, groups, selected, onAdd, onRemove, tagColor,
}: {
  label: string;
  icon: React.ReactNode;
  placeholder: string;
  options: { id: string; name: string; sub?: string }[];
  groups?: { label: string; options: { id: string; name: string; sub?: string }[] }[];
  selected: { id: string; name: string }[];
  onAdd: (item: { id: string; name: string }) => void;
  onRemove: (id: string) => void;
  tagColor: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // expand all groups by default when opened
  useEffect(() => {
    if (open && groups && expandedUnits.size === 0) {
      setExpandedUnits(new Set(groups.map(g => g.label)));
    }
  }, [open, groups]);

  const allOptions = groups ? groups.flatMap(g => g.options) : options;

  const isSelected = (id: string) => !!selected.find(s => s.id === id);

  const filtered = allOptions.filter(o =>
    !isSelected(o.id) &&
    (o.name.toLowerCase().includes(query.toLowerCase()) || (o.sub || '').toLowerCase().includes(query.toLowerCase()))
  );

  useEffect(() => { setHighlightedIndex(0); }, [query, open]);

  const toggleUnit = (label: string) => setExpandedUnits(prev => {
    const next = new Set(prev);
    next.has(label) ? next.delete(label) : next.add(label);
    return next;
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered.length > 0) {
        const item = filtered[highlightedIndex] || filtered[0];
        onAdd({ id: item.id, name: item.name });
        setQuery('');
        setHighlightedIndex(0);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlightedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const renderDropdown = () => {
    if (query || !groups) {
      // flat filtered list
      if (filtered.length === 0) return <div className="p-3 text-sm text-gray-400">کاربری یافت نشد</div>;
      return filtered.slice(0, 8).map((o, idx) => (
        <button key={o.id} type="button"
          onClick={() => { onAdd({ id: o.id, name: o.name }); setQuery(''); }}
          className={`w-full text-right px-3 py-2 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0 ${idx === highlightedIndex ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
          <span>{o.name}</span>
          {o.sub && <span className="text-xs text-gray-400 truncate max-w-[120px]">{o.sub}</span>}
        </button>
      ));
    }

    // grouped display — highlight uses flat filtered index
    let flatIdx = 0;
    return groups.map(g => {
      const groupOptions = g.options.filter(o => !isSelected(o.id));
      if (groupOptions.length === 0) return null;
      const expanded = expandedUnits.has(g.label);
      return (
        <div key={g.label}>
          <button type="button" onClick={() => toggleUnit(g.label)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-600/60 text-right hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors sticky top-0 z-10">
            <Building2 className="w-3 h-3 text-blue-400 flex-shrink-0" />
            <span className="flex-1 text-xs font-semibold text-gray-500 dark:text-gray-300 truncate">{g.label}</span>
            <span className="text-xs text-gray-400">{groupOptions.length}</span>
            {expanded ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
          </button>
          {expanded && groupOptions.map(o => {
            const currentIdx = flatIdx++;
            return (
              <button key={o.id} type="button"
                onClick={() => { onAdd({ id: o.id, name: o.name }); setQuery(''); }}
                className={`w-full text-right px-4 py-2 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0 pr-6 ${currentIdx === highlightedIndex ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
                <span>{o.name}</span>
                {o.sub && <span className="text-xs text-gray-400 truncate max-w-[120px]">{o.sub}</span>}
              </button>
            );
          })}
        </div>
      );
    });
  };

  const hasItems = query ? filtered.length > 0 : (groups ? groups.some(g => g.options.some(o => !isSelected(o.id))) : filtered.length > 0);

  return (
    <div ref={ref}>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {icon}{label}
      </label>
      <div
        className="flex flex-wrap gap-1.5 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 cursor-text min-h-[42px]"
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {selected.map(s => (
          <span key={s.id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${tagColor}`}>
            {s.name}
            <button type="button" onClick={e => { e.stopPropagation(); onRemove(s.id); }} className="hover:opacity-70">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] outline-none bg-transparent text-sm dark:text-white placeholder-gray-400"
        />
      </div>
      {open && hasItems && (
        <div className="relative z-20">
          <div className="absolute w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-52 overflow-y-auto">
            {renderDropdown()}
          </div>
        </div>
      )}
    </div>
  );
}

export function CalendarMeetingForm({ onSuccess, onCancel, prefillData, calendars = [] }: CalendarMeetingFormProps) {
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [location, setLocation] = useState('');
  const [representative, setRepresentative] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [priority, setPriority] = useState('medium');
  const [selectedCalendarId, setSelectedCalendarId] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [scheduleDate, setScheduleDate] = useState<{jy:number;jm:number;jd:number}|null>(null);
  const [prefillMeetingId, setPrefillMeetingId] = useState<string|null>(null);
  const [prefillEditAllIds, setPrefillEditAllIds] = useState<string[]|null>(null);
  const [saveContact, setSaveContact] = useState(false);
  const [membersOnly, setMembersOnly] = useState(false);
  const lastPrefillRef = useRef<string>('');

  const [selectedParticipants, setSelectedParticipants] = useState<{id:string;name:string}[]>([]);
  const [selectedNotifyUsers, setSelectedNotifyUsers] = useState<{id:string;name:string}[]>([]);

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

  // Contact picker for representative
  const [allContacts, setAllContacts] = useState<ContactEmail[]>([]);
  const [showRepPicker, setShowRepPicker] = useState(false);
  const [repPickerSearch, setRepPickerSearch] = useState('');
  const [repFromContacts, setRepFromContacts] = useState(false);
  const repPickerRef = useRef<HTMLDivElement>(null);

  // Manual date/time override
  const [showManualDateTime, setShowManualDateTime] = useState(false);
  const [manualDateStr, setManualDateStr] = useState('');
  const [manualStartTime, setManualStartTime] = useState('');
  const [manualEndTime, setManualEndTime] = useState('');

  // Repeat
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatType, setRepeatType] = useState<'weekly'|'monthly'>('weekly');
  const [repeatInterval, setRepeatInterval] = useState(1);
  const [repeatEndDate, setRepeatEndDate] = useState('');
  const [repeatWeekday, setRepeatWeekday] = useState(0);
  const [repeatMonthlyMode, setRepeatMonthlyMode] = useState<'specific'|'nth'>('specific');
  const [repeatMonthlyNth, setRepeatMonthlyNth] = useState(1);
  const [repeatMonthlyNthWeekday, setRepeatMonthlyNthWeekday] = useState(0);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [endDatePickerJy, setEndDatePickerJy] = useState(() => moment().jYear());
  const [endDatePickerJm, setEndDatePickerJm] = useState(() => moment().jMonth() + 1);

  const [reminderMinutes, setReminderMinutes] = useState(15);
  const [sendSms, setSendSms] = useState(false);
  const [meetingManager, setMeetingManager] = useState('');
  const [isOnline, setIsOnline] = useState(false);

  // Agenda
  const [agendaEnabled, setAgendaEnabled] = useState(false);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [showAgendaForm, setShowAgendaForm] = useState(false);
  const [agendaForm, setAgendaForm] = useState<{ title: string; presenter: string; duration_minutes: string }>({ title: '', presenter: '', duration_minutes: '' });
  const [editingAgendaIdx, setEditingAgendaIdx] = useState<number | null>(null);

  // Org users for grouped pickers
  const { groups: orgGroups, allUsers: orgAllUsers, loading: orgUsersLoading } = useOrgUsers(userId);

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
    orgAllUsers.find(u => u.user_id === uid)?.full_name?.trim()
    || selectedParticipants.find(p => p.id === uid)?.name?.trim()
    || selectedNotifyUsers.find(u => u.id === uid)?.name?.trim()
    || 'همکار گرامی';
  const resolveUsersByIds = (ids: string[]): { id: string; name: string }[] =>
    ids.map(id => ({ id, name: resolveUserName(id) }));

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setUserId(user.id);
        fetchContacts(user.id);
      }
    })();
  }, []);

  // Auto-select the user's public calendar as default when no prefill sets a calendarId
  useEffect(() => {
    if (selectedCalendarId) return;
    const publicCal =
      calendars.find(c => c.is_personal_public && c.type === 'public') ||
      calendars.find(c => c.type === 'public' && !c.is_occasions);
    if (publicCal) setSelectedCalendarId(publicCal.id);
  }, [calendars]);
  const fetchContacts = async (uid: string) => {
    const { data } = await supabase.from('contacts_email').select('*').eq('user_id', uid).order('name');
    setContacts(data || []);
    setAllContacts(data || []);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (repPickerRef.current && !repPickerRef.current.contains(e.target as Node)) setShowRepPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Load prefill — runs whenever prefillData changes (identified by JSON fingerprint)
  useEffect(() => {
    if (!prefillData) return;
    const key = JSON.stringify(prefillData);
    if (key === lastPrefillRef.current) return;
    lastPrefillRef.current = key;

    setSubject(prefillData.subject || '');
    setLocation(prefillData.location || '');
    setRepresentative(prefillData.representative || '');
    setPhone(prefillData.phone || '');
    setNotes(prefillData.notes || '');
    setPriority(prefillData.priority || 'medium');
    setStartTime(prefillData.startTime || '');
    setEndTime(prefillData.endTime || '');
    if (prefillData.dateJy && prefillData.dateJm && prefillData.dateJd) {
      setScheduleDate({ jy: prefillData.dateJy, jm: prefillData.dateJm, jd: prefillData.dateJd });
    }
    if (prefillData.meetingId) {
      setPrefillMeetingId(prefillData.meetingId);
      loadMeetingParticipants(prefillData.meetingId);
    }
    setPrefillEditAllIds(prefillData.editAllIds && prefillData.editAllIds.length > 0 ? prefillData.editAllIds : null);
    if (prefillData.calendarId) setSelectedCalendarId(prefillData.calendarId);
    if (prefillData.membersOnly !== undefined) setMembersOnly(prefillData.membersOnly);
    if (prefillData.repeatEnabled) {
      setRepeatEnabled(true);
      if (prefillData.repeatType) setRepeatType(prefillData.repeatType);
      if (prefillData.repeatInterval) setRepeatInterval(prefillData.repeatInterval);
      if (prefillData.repeatEndDate) setRepeatEndDate(prefillData.repeatEndDate);
      if (prefillData.repeatWeekday !== undefined) setRepeatWeekday(prefillData.repeatWeekday);
    }
    if (prefillData.participantUserIds && prefillData.participantUserIds.length > 0) {
      setSelectedParticipants(resolveUsersByIds(prefillData.participantUserIds));
    }
  }, [prefillData]);

  const loadMeetingParticipants = async (meetingId: string) => {
    const { data } = await supabase.from('meetings').select('participant_user_ids, notify_users, external_participants, meeting_manager').eq('id', meetingId).maybeSingle();
    if (!data) return;

    if ((data.participant_user_ids || []).length > 0) {
      setSelectedParticipants(resolveUsersByIds(data.participant_user_ids as string[]));
    }
    if ((data.notify_users || []).length > 0) {
      const notifyIds = (data.notify_users as string[]);
      // Exclude the current user (creator) from the visible notify list since they're auto-included
      setSelectedNotifyUsers(resolveUsersByIds(notifyIds));
    }
    if ((data.external_participants || []).length > 0) {
      setSelectedExternal(data.external_participants as string[]);
    }
    if (data.meeting_manager) {
      setMeetingManager(data.meeting_manager);
    }

    // Load agenda items
    const { data: items } = await supabase
      .from('meeting_agenda_items')
      .select('*')
      .eq('meeting_id', meetingId)
      .order('sort_order');
    if (items && items.length > 0) {
      setAgendaEnabled(true);
      setAgendaItems(items as AgendaItem[]);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (externalSearchRef.current && !externalSearchRef.current.contains(e.target as Node)) setShowExternalDropdown(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedCalendar = calendars.find(c => c.id === selectedCalendarId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) { toast.error('لطفا وارد شوید'); return; }
    if (!subject.trim()) { toast.error('موضوع جلسه را وارد کنید'); return; }
    if (!scheduleDate) { toast.error('تاریخ جلسه مشخص نیست'); return; }
    if (orgUsersLoading) { toast.error('اطلاعات سازمانی در حال بارگذاری است؛ لحظاتی دیگر تلاش کنید'); return; }
    const senderName = orgAllUsers.find(u => u.user_id === userId)?.full_name?.trim();
    if (!senderName) { toast.error('اطلاعات سازمانی کاربر کامل نیست؛ امکان ثبت جلسه وجود ندارد.'); return; }
    setLoading(true);
    try {
      const m = moment(`${scheduleDate.jy}/${scheduleDate.jm}/${scheduleDate.jd}`, 'jYYYY/jM/jD');
      const gregDate = m.toDate().toISOString();

      // Create conference room first if this is an online meeting
      let conferenceRoomId: string | null = null;
      let conferenceRoomCode: string | null = null;
      if (isOnline) {
        const room = await createConferenceRoom(subject);
        conferenceRoomId = room?.id || null;
        conferenceRoomCode = room?.code || null;
      }

      const joinLink = conferenceRoomCode
        ? `${window.location.origin}?conference=${conferenceRoomCode}`
        : '';

      const record: any = {
        subject, request_date: gregDate,
        duration: startTime && endTime ? `${startTime} - ${endTime}` : '',
        start_time: startTime, end_time: endTime,
        location, representative, phone, notes: notes || null, priority,
        status: 'archived', status_type: 'scheduled', user_id: userId,
        notify_users: Array.from(new Set([userId, ...selectedNotifyUsers.map(u => u.id)])),
        participant_user_ids: selectedParticipants.map(p => p.id),
        external_participants: selectedExternal,
        repeat_type: repeatEnabled ? repeatType : 'none',
        repeat_interval: repeatEnabled ? repeatInterval : null,
        repeat_end_date: repeatEnabled ? repeatEndDate : null,
        repeat_weekday: repeatEnabled && repeatType === 'weekly' ? repeatWeekday : null,
        reminder_minutes: reminderMinutes || null,
        send_sms: sendSms, meeting_manager: meetingManager || null,
        calendar_id: selectedCalendarId || null,
        members_only: (selectedParticipants.length > 0 || selectedNotifyUsers.filter(u => u.id !== userId).length > 0)
          ? true
          : ((selectedCalendarId && selectedCalendar?.type === 'shared') ? membersOnly : false),
        is_online: isOnline,
        conference_room_id: conferenceRoomId,
      };

      const meetingDateStr = scheduleDate ? `${scheduleDate.jy}/${String(scheduleDate.jm).padStart(2, '0')}/${String(scheduleDate.jd).padStart(2, '0')}` : '';
      const meetingTimeStr = startTime && endTime ? `${startTime}-${endTime}` : startTime || '';
      const smsPlaceholders: Record<string, string> = {
        meeting_subject: subject,
        meeting_date: meetingDateStr,
        start_time: startTime || '',
        end_time: endTime || '',
        meeting_time: meetingTimeStr,
        location: location || '',
        location_part: location ? ` | ${location}` : '',
        join_link: joinLink,
        sender_name: senderName,
        organizer_name: senderName,
        representative: representative || '',
        agenda: agendaEnabled && agendaItems.length > 0
          ? agendaItems.map((item, idx) => {
              const parts = [`${idx + 1}. ${item.title}`];
              if (item.presenter) parts.push(`ارائه‌دهنده: ${item.presenter}`);
              if (item.duration_minutes) parts.push(`${item.duration_minutes} دقیقه`);
              return parts.join(' | ');
            }).join('\n')
          : '',
      };

      // Build agenda summary for notification messages
      const agendaSummary = agendaEnabled && agendaItems.length > 0
        ? '\n\nدستور جلسه:\n' + agendaItems.map((item, idx) => {
            const parts = [`${idx + 1}. ${item.title}`];
            if (item.presenter) parts.push(`ارائه‌دهنده: ${item.presenter}`);
            if (item.duration_minutes) parts.push(`${item.duration_minutes} دقیقه`);
            return parts.join(' | ');
          }).join('\n')
        : '';

      // Resolve display names via useOrgUsers data (no direct profiles query)
      let participantNameMap: Record<string, string> = {};
      const participantIds = selectedParticipants.map(p => p.id).filter(id => id !== userId);
      const observerIds = selectedNotifyUsers.map(u => u.id).filter(id => id !== userId);
      const recipientIds = [...participantIds, ...observerIds];
      for (const uid of recipientIds) {
        participantNameMap[uid] = resolveUserName(uid);
      }

      if (prefillMeetingId) {
        // Detect first-time scheduling vs edit (for correct notification type)
        const { data: existingMtg } = await supabase
          .from('meetings')
          .select('start_time')
          .eq('id', prefillMeetingId)
          .maybeSingle();
        const isFirstSchedule = !existingMtg?.start_time;

        const updateRecord: any = {
          subject, request_date: gregDate,
          duration: startTime && endTime ? `${startTime} - ${endTime}` : '',
          start_time: startTime, end_time: endTime,
          location, representative, phone, notes: notes || null, priority,
          status: 'archived', status_type: 'scheduled',
          notify_users: Array.from(new Set([userId, ...selectedNotifyUsers.map(u => u.id)])),
          participant_user_ids: selectedParticipants.map(p => p.id),
          external_participants: selectedExternal,
          repeat_type: repeatEnabled ? repeatType : 'none',
          repeat_interval: repeatEnabled ? repeatInterval : null,
          repeat_end_date: repeatEnabled ? repeatEndDate : null,
          repeat_weekday: repeatEnabled && repeatType === 'weekly' ? repeatWeekday : null,
          reminder_minutes: reminderMinutes || null,
          send_sms: sendSms, meeting_manager: meetingManager || null,
          calendar_id: selectedCalendarId || null,
          members_only: (selectedParticipants.length > 0 || selectedNotifyUsers.filter(u => u.id !== userId).length > 0)
            ? true
            : ((selectedCalendarId && selectedCalendar?.type === 'shared') ? membersOnly : false),
          is_online: isOnline,
          ...(isOnline && !conferenceRoomId ? {} : { conference_room_id: conferenceRoomId }),
        };

        if (prefillEditAllIds && prefillEditAllIds.length > 0) {
          // Bulk update: apply changes to all repeat instances (keeping each one's own date)
          const baseFields = { subject, location, representative, phone, notes: notes || null, priority,
            start_time: startTime, end_time: endTime,
            duration: startTime && endTime ? `${startTime} - ${endTime}` : '',
            status: 'archived', status_type: 'scheduled',
            notify_users: updateRecord.notify_users,
            participant_user_ids: updateRecord.participant_user_ids,
            external_participants: selectedExternal,
            repeat_type: updateRecord.repeat_type, repeat_interval: updateRecord.repeat_interval,
            repeat_end_date: updateRecord.repeat_end_date, repeat_weekday: updateRecord.repeat_weekday,
            reminder_minutes: reminderMinutes || null,
            send_sms: sendSms, meeting_manager: meetingManager || null,
            calendar_id: selectedCalendarId || null,
            members_only: updateRecord.members_only, is_online: isOnline,
          };
          const { error } = await supabase.from('meetings').update(baseFields).in('id', prefillEditAllIds);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('meetings').update(updateRecord).eq('id', prefillMeetingId);
          if (error) throw error;
        }

        // Save agenda items
        if (prefillMeetingId) {
          await supabase.from('meeting_agenda_items').delete().eq('meeting_id', prefillMeetingId);
          if (agendaEnabled && agendaItems.length > 0) {
            await supabase.from('meeting_agenda_items').insert(
              agendaItems.map((item, idx) => ({
                meeting_id: prefillMeetingId,
                title: item.title,
                presenter: item.presenter || null,
                duration_minutes: item.duration_minutes || null,
                sort_order: idx,
              }))
            );
          }
        }

        // Sync meeting_inbox approval records with participant diff.
        // Read previous participants from DB (not frontend state) for security.
        const { data: prevMtg } = await supabase
          .from('meetings')
          .select('participant_user_ids')
          .eq('id', prefillMeetingId)
          .maybeSingle();
        const previousParticipantIds = Array.from(new Set(
          ((prevMtg?.participant_user_ids || []) as string[]).filter(id => id !== userId)
        ));
        const nextParticipantIds = Array.from(new Set(
          selectedParticipants.map(p => p.id).filter(id => id !== userId)
        ));
        const addedParticipantIds = nextParticipantIds.filter(id => !previousParticipantIds.includes(id));
        const retainedParticipantIds = nextParticipantIds.filter(id => previousParticipantIds.includes(id));
        const removedParticipantIds = previousParticipantIds.filter(id => !nextParticipantIds.includes(id));

        // Remove inbox entries for removed participants (any status)
        if (removedParticipantIds.length > 0) {
          await supabase.from('meeting_inbox')
            .delete()
            .eq('meeting_id', prefillMeetingId)
            .in('user_id', removedParticipantIds);
        }
        // Insert pending approval for added participants only (retained status preserved)
        if (addedParticipantIds.length > 0) {
          await supabase.from('meeting_inbox').upsert(
            addedParticipantIds.map(uid => ({ meeting_id: prefillMeetingId, user_id: uid, status: 'pending' })),
            { onConflict: 'meeting_id,user_id' }
          );
        }

        const creatorAction: MeetingAction = isFirstSchedule ? 'created' : 'change';
        const creatorEventType = getMeetingTemplateKey('creator', creatorAction);
        await insertNotification({ userId, category: 'meeting', eventType: creatorEventType, fallbackTitle: isFirstSchedule ? 'جلسه زمان‌بندی شد' : 'جلسه ویرایش شد', fallbackMessage: `جلسه "${subject}" ${isFirstSchedule ? 'زمان‌بندی' : 'ویرایش'} شد${agendaSummary}`, placeholders: { ...smsPlaceholders, full_name: senderName, recipient_greeting: `${senderName} گرامی` }, senderId: userId, senderName: senderName, actionUrl: 'calendar' });

        const internalSmsResults: SmsDispatchResult[] = [];
        // Added participants receive invitation (same as initial create), never "change" SMS
        if (addedParticipantIds.length) {
          const addedEventType = getMeetingTemplateKey('participant', 'invite');
          const results = await Promise.all(addedParticipantIds.map(uid => insertNotification({ userId: uid, category: 'meeting', eventType: addedEventType, audience: 'participants', fallbackTitle: 'دعوت به جلسه', fallbackMessage: `شما به جلسه "${subject}" دعوت شدید — ${meetingTimeStr}${meetingDateStr ? ` در ${meetingDateStr}` : ''}${agendaSummary}`, placeholders: { ...smsPlaceholders, full_name: participantNameMap[uid] || '', recipient_greeting: participantNameMap[uid] ? `${participantNameMap[uid]} گرامی` : 'همکار گرامی' }, senderId: userId, senderName: senderName, actionUrl: 'calendar' })));
          internalSmsResults.push(...results);
        }
        // Retained participants receive "change" notification only on edit (not first schedule)
        if (!isFirstSchedule && retainedParticipantIds.length) {
          const retainedEventType = getMeetingTemplateKey('participant', 'change');
          const results = await Promise.all(retainedParticipantIds.map(uid => insertNotification({ userId: uid, category: 'meeting', eventType: retainedEventType, audience: 'participants', fallbackTitle: 'تغییر در جلسه', fallbackMessage: `جلسه "${subject}" ویرایش شد — ${meetingTimeStr}${meetingDateStr ? ` در ${meetingDateStr}` : ''}${agendaSummary}`, placeholders: { ...smsPlaceholders, full_name: participantNameMap[uid] || '', recipient_greeting: participantNameMap[uid] ? `${participantNameMap[uid]} گرامی` : 'همکار گرامی' }, senderId: userId, senderName: senderName, actionUrl: 'calendar' })));
          internalSmsResults.push(...results);
        }
        if (observerIds.length) {
          const observerAction: MeetingAction = isFirstSchedule ? 'invite' : 'change';
          const observerEventType = getMeetingTemplateKey('observer', observerAction);
          const results = await Promise.all(observerIds.map(uid => insertNotification({ userId: uid, category: 'meeting', eventType: observerEventType, audience: 'observers', fallbackTitle: isFirstSchedule ? 'اطلاع از جلسه' : 'تغییر در جلسه', fallbackMessage: `شما به عنوان مطلع جلسه "${subject}" ثبت شده‌اید — ${meetingTimeStr}${meetingDateStr ? ` در ${meetingDateStr}` : ''}${agendaSummary}`, placeholders: { ...smsPlaceholders, full_name: participantNameMap[uid] || '', recipient_greeting: participantNameMap[uid] ? `${participantNameMap[uid]} گرامی` : 'همکار گرامی' }, senderId: userId, senderName: senderName, actionUrl: 'calendar' })));
          internalSmsResults.push(...results);
        }
        let externalSmsResult: ExternalSmsResult | null = null;
        if (sendSms && selectedExternal.length > 0) {
          const fallbackSms = `دعوت به جلسه: «${subject}» | تاریخ: ${meetingDateStr} | ساعت: ${meetingTimeStr}${smsPlaceholders.location_part}`;
          externalSmsResult = await sendSmsToExternals(selectedExternal, contacts, fallbackSms, userId, smsPlaceholders);
        }
        showSmsSummary(internalSmsResults, externalSmsResult);
      } else {
        const { data: md, error: me } = await supabase.from('meetings').insert([record]).select().single();
        if (me) throw me;
        if (md) {
          if (selectedParticipants.length > 0) {
            await supabase.from('participants').insert(selectedParticipants.map(p => ({ meeting_id: md.id, name: p.name })));
          }
          // Save agenda items
          if (agendaEnabled && agendaItems.length > 0) {
            await supabase.from('meeting_agenda_items').insert(
              agendaItems.map((item, idx) => ({
                meeting_id: md.id,
                title: item.title,
                presenter: item.presenter || null,
                duration_minutes: item.duration_minutes || null,
                sort_order: idx,
              }))
            );
          }
          // Inbox entries for participants only (excluding creator); notify_users see meeting via RLS directly
          const inboxUserIds = selectedParticipants
            .map(p => p.id)
            .filter(id => id !== userId);
          if (inboxUserIds.length > 0) {
            await supabase.from('meeting_inbox').insert(
              inboxUserIds.map(uid => ({ meeting_id: md.id, user_id: uid, status: 'pending' }))
            );
          }
        }
        if (repeatEnabled && md && repeatEndDate) await createRepeatMeetings(record, repeatType, repeatInterval, repeatEndDate);
        await insertNotification({ userId, category: 'meeting', eventType: getMeetingTemplateKey('creator', 'created'), fallbackTitle: 'جلسه ثبت شد', fallbackMessage: `جلسه "${subject}" ثبت شد — ${meetingTimeStr}${agendaSummary}`, placeholders: { ...smsPlaceholders, full_name: senderName, recipient_greeting: `${senderName} گرامی` }, senderId: userId, senderName: senderName, actionUrl: 'calendar' });

        const internalSmsResults: SmsDispatchResult[] = [];
        if (participantIds.length) {
          const results = await Promise.all(participantIds.map(uid => insertNotification({ userId: uid, category: 'meeting', eventType: 'invite', audience: 'participants', fallbackTitle: 'دعوت به جلسه', fallbackMessage: `شما به جلسه "${subject}" دعوت شدید — ${meetingTimeStr}${meetingDateStr ? ` در ${meetingDateStr}` : ''}${agendaSummary}`, placeholders: { ...smsPlaceholders, full_name: participantNameMap[uid] || '', recipient_greeting: participantNameMap[uid] ? `${participantNameMap[uid]} گرامی` : 'همکار گرامی' }, senderId: userId, senderName: senderName, actionUrl: 'calendar' })));
          internalSmsResults.push(...results);
        }
        if (observerIds.length) {
          const results = await Promise.all(observerIds.map(uid => insertNotification({ userId: uid, category: 'meeting', eventType: 'invite', audience: 'observers', fallbackTitle: 'اطلاع از جلسه', fallbackMessage: `شما به عنوان مطلع جلسه "${subject}" ثبت شده‌اید — ${meetingTimeStr}${meetingDateStr ? ` در ${meetingDateStr}` : ''}${agendaSummary}`, placeholders: { ...smsPlaceholders, full_name: participantNameMap[uid] || '', recipient_greeting: participantNameMap[uid] ? `${participantNameMap[uid]} گرامی` : 'همکار گرامی' }, senderId: userId, senderName: senderName, actionUrl: 'calendar' })));
          internalSmsResults.push(...results);
        }
        let externalSmsResult: ExternalSmsResult | null = null;
        if (sendSms && selectedExternal.length > 0) {
          const fallbackSms = `دعوت به جلسه: «${subject}» | تاریخ: ${meetingDateStr} | ساعت: ${meetingTimeStr}${smsPlaceholders.location_part}`;
          externalSmsResult = await sendSmsToExternals(selectedExternal, contacts, fallbackSms, userId, smsPlaceholders);
        }
        showSmsSummary(internalSmsResults, externalSmsResult);
      }
      if (saveContact && representative?.trim() && phone?.trim() && userId) {
        const { error: contactError } = await supabase
          .from('contacts_email') // نام جدول اصلاح شد
          .insert([
            {
              name: representative.trim(),
              phone: phone.trim(),
              user_id: userId,
              email: null,   // در ساختار جدید شما YES (اختیاری) است
              company: ''    // مطابق با مقدار پیش‌فرض جدول شما
            },
          ]);
        if (contactError) {
          // نمایش علت دقیق خطا در کنسول برای رفع عیب سریع
          console.error('Detailed DB Error:', contactError);
          toast.error('جلسه ثبت شد ولی شماره تماس ذخیره نشد');
        } else {
          console.log('مخاطب با موفقیت ذخیره شد');
        }
      }
      onSuccess(subject, !!prefillMeetingId);
    } catch (err: any) { toast.error(err?.message || 'خطا در ثبت جلسه'); }
    finally { setLoading(false); }
  };

  const generateRoomCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const seg = () => Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${seg()}-${seg()}-${seg()}`;
  };

  const createConferenceRoom = async (meetingSubject: string): Promise<{ id: string; code: string } | null> => {
    if (!userId) return null;
    try {
      const code = generateRoomCode();
      const { data, error } = await supabase
        .from('conference_rooms')
        .insert([{
          name: meetingSubject,
          code,
          host_id: userId,
          status: 'active',
          password: null,
          waiting_room_enabled: false,
          is_locked: false,
        }])
        .select()
        .single();
      if (error) throw error;
      return data ? { id: data.id, code: data.code || code } : null;
    } catch {
      return null;
    }
  };

  const createRepeatMeetings = async (baseRecord: any, type: string, interval: number, endDate: string) => {
    if (!endDate) return;
    let endMs: number;
    if (endDate.includes('/') && endDate.split('/').length === 3) {
      const [jy, jm, jd] = endDate.split('/').map(Number);
      const gd = moment(`${jy}/${jm}/${jd}`, 'jYYYY/jM/jD').toDate();
      gd.setHours(23, 59, 59, 999); endMs = gd.getTime();
    } else { endMs = new Date(endDate).getTime(); }
    if (isNaN(endMs)) return;

    const baseDate = new Date(baseRecord.request_date);
    const repeatMeetings: any[] = [];
    // 0=شنبه→JS6, 1=یکشنبه→JS0, 2=دوشنبه→JS1, ..., 6=جمعه→JS5
    const jsDayMap = [6, 0, 1, 2, 3, 4, 5];

    if (type === 'weekly') {
      const targetJsDay = jsDayMap[repeatWeekday];
      // Find the first occurrence of targetJsDay strictly after baseDate
      let cur = new Date(baseDate);
      cur.setDate(cur.getDate() + 1); // at least one day after base
      const diff = (targetJsDay - cur.getDay() + 7) % 7;
      cur.setDate(cur.getDate() + diff);
      while (cur.getTime() <= endMs) {
        const jDate = moment(cur).format('jYYYY/jMM/jDD');
        const { id: _id, ...recordWithoutId } = baseRecord;
        repeatMeetings.push({ ...recordWithoutId, request_date: cur.toISOString(), request_jalaali_date: jDate });
        cur = new Date(cur.getTime() + 7 * interval * 86400000);
      }
    } else {
      // Monthly — iterate Jalaali months to correctly handle Persian calendar
      const jsDayMapM = [6, 0, 1, 2, 3, 4, 5];
      const baseJalaali = moment(baseDate).format('jYYYY/jMM/jDD').split('/').map(Number);
      const baseJy = baseJalaali[0];
      const baseJm = baseJalaali[1];
      const baseJd = baseJalaali[2];

      const getNthWeekdayOfMonth = (year: number, month: number, nth: number, targetJsDay: number): Date => {
        // Get Gregorian range for this Jalaali month
        const firstDay = moment(`${year}/${month}/1`, 'jYYYY/jM/jD').toDate();
        const lastDayNum = month <= 6 ? 31 : month <= 11 ? 30 : 29;
        const lastDay = moment(`${year}/${month}/${lastDayNum}`, 'jYYYY/jM/jD').toDate();

        if (nth === -1) {
          // Last occurrence: start from last day, go backwards
          let d = new Date(lastDay);
          while (d.getDay() !== targetJsDay) d.setDate(d.getDate() - 1);
          return d;
        }
        // nth >= 1: start from first day, count forward
        let d = new Date(firstDay);
        let count = 0;
        while (count < nth) {
          if (d.getDay() === targetJsDay) count++;
          if (count < nth) d.setDate(d.getDate() + 1);
        }
        return d;
      };

      // Iterate Jalaali month offsets
      for (let offset = 0; ; offset += interval) {
        let jy = baseJy;
        let jm = baseJm + offset;
        while (jm > 12) { jy++; jm -= 12; }

        let d: Date;
        if (repeatMonthlyMode === 'nth') {
          const targetJsDay = jsDayMapM[repeatMonthlyNthWeekday];
          d = getNthWeekdayOfMonth(jy, jm, repeatMonthlyNth, targetJsDay);
        } else {
          // Same Jalaali day each month
          const dayInMonth = Math.min(baseJd, jm <= 6 ? 31 : jm <= 11 ? 30 : 29);
          d = moment(`${jy}/${jm}/${dayInMonth}`, 'jYYYY/jM/jD').toDate();
        }

        if (d.getTime() > endMs) break;
        // Skip if same day or earlier than base meeting date
        if (d.getTime() > baseDate.getTime()) {
          const jDate = moment(d).format('jYYYY/jMM/jDD');
          const { id: _id, ...recordWithoutId } = baseRecord;
          repeatMeetings.push({ ...recordWithoutId, request_date: d.toISOString(), request_jalaali_date: jDate });
        }
      }
    }
    if (repeatMeetings.length > 0) {
      const { data: inserted, error: repeatError } = await supabase.from('meetings').insert(repeatMeetings).select('id, participant_user_ids');
      if (repeatError) { console.error('Repeat insert error:', repeatError); toast.error('خطا در ایجاد جلسات تکراری: ' + repeatError.message); }
      else {
        toast.success(`${repeatMeetings.length} جلسه تکراری ایجاد شد`);
        // Create inbox entries for participants only (notify_users see meeting via RLS directly)
        const inboxRows: { meeting_id: string; user_id: string; status: string }[] = [];
        for (const row of (inserted || [])) {
          for (const pid of (row.participant_user_ids || [])) {
            if (pid !== baseRecord.user_id) {
              inboxRows.push({ meeting_id: row.id, user_id: pid, status: 'pending' });
            }
          }
        }
        if (inboxRows.length > 0) {
          await supabase.from('meeting_inbox').insert(inboxRows);
        }
      }
    }
  };

  const externalOptions = contacts.map(c => ({ id: c.name, name: c.name, sub: c.email }));
  const filteredExternal = externalOptions.filter(c =>
    !selectedExternal.includes(c.id) &&
    (c.name.toLowerCase().includes(externalSearch.toLowerCase()) || (c.sub ?? '').toLowerCase().includes(externalSearch.toLowerCase()))
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

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0 bg-teal-600">
        <h2 className="text-base font-bold text-white">تنظیم جلسه در تقویم</h2>
        <button type="button" onClick={onCancel} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30">
          <X className="w-5 h-5 text-white" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Calendar selector */}
        <div className="p-3 bg-teal-50 dark:bg-teal-900/20 rounded-xl border border-teal-200 dark:border-teal-700 space-y-3">
          <div>
            <label className="block text-sm font-medium text-teal-700 dark:text-teal-300 mb-1.5">نوع تقویم</label>
            <select value={selectedCalendarId} onChange={e => { setSelectedCalendarId(e.target.value); if (!e.target.value) setMembersOnly(false); }}
              className="w-full p-2 border border-teal-200 dark:border-teal-600 rounded-lg bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
              {calendars.filter(c => c.type !== 'private').map(c => <option key={c.id} value={c.id}>{c.name} ({c.type === 'shared' ? 'اشتراکی' : 'عمومی'})</option>)}
            </select>
            {selectedCalendarId && selectedCalendar && (
              <div className="flex items-center gap-2 mt-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedCalendar.color }} />
                <span className="text-xs text-teal-600 dark:text-teal-400">{selectedCalendar.name}</span>
              </div>
            )}
          </div>

          {/* members_only toggle — only for shared calendars */}
          {selectedCalendarId && selectedCalendar?.type === 'shared' && (
            <div className="flex items-center justify-between gap-3 p-2.5 bg-white dark:bg-gray-800 rounded-lg border border-teal-100 dark:border-teal-800">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">نمایش فقط برای اعضای جلسه</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                  {membersOnly
                    ? 'فقط شرکت‌کنندگان و مطلعین این جلسه را می‌بینند'
                    : 'تمام اعضای تقویم این جلسه را می‌بینند'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMembersOnly(v => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${membersOnly ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${membersOnly ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          )}
        </div>

        {/* Date + Time */}
        {scheduleDate && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 border border-blue-200 dark:border-blue-700 rounded-xl bg-blue-50 dark:bg-blue-900/20">
                <p className="text-xs text-blue-500 mb-0.5">تاریخ جلسه</p>
                <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                  {showManualDateTime && manualDateStr ? manualDateStr : `${scheduleDate.jd} ${JALAALI_MONTHS[scheduleDate.jm-1]} ${scheduleDate.jy}`}
                </p>
              </div>
              <div className="p-3 border border-blue-200 dark:border-blue-700 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <div>
                  <p className="text-xs text-blue-500 mb-0.5">زمان جلسه</p>
                  <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
                    {showManualDateTime && manualStartTime ? `${manualStartTime} — ${manualEndTime}` : `${startTime} — ${endTime}`}
                  </p>
                </div>
              </div>
            </div>
            {/* Manual date/time override toggle */}
            <button type="button" onClick={() => { setShowManualDateTime(v => !v); if (!manualDateStr && scheduleDate) setManualDateStr(`${scheduleDate.jy}/${String(scheduleDate.jm).padStart(2,'0')}/${String(scheduleDate.jd).padStart(2,'0')}`); if (!manualStartTime) setManualStartTime(startTime); if (!manualEndTime) setManualEndTime(endTime); }}
              className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline">
              <Edit2 className="w-3 h-3" />{showManualDateTime ? 'بستن ویرایش دستی' : 'تغییر دستی تاریخ و ساعت'}
            </button>
            {showManualDateTime && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-700">
                <div>
                  <label className="block text-xs text-blue-600 dark:text-blue-400 mb-1">تاریخ (شمسی)</label>
                  <input type="text" value={manualDateStr} onChange={e => {
                    setManualDateStr(e.target.value);
                    const parts = e.target.value.split('/').map(Number);
                    if (parts.length === 3 && parts[0] > 1300 && parts[1] >= 1 && parts[1] <= 12 && parts[2] >= 1) {
                      const gd = moment(`${parts[0]}/${parts[1]}/${parts[2]}`, 'jYYYY/jM/jD').toDate();
                      if (!isNaN(gd.getTime())) setScheduleDate({ jy: parts[0], jm: parts[1], jd: parts[2] });
                    }
                  }}
                    placeholder="1405/03/15"
                    className="w-full p-2 border border-blue-300 dark:border-blue-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-blue-600 dark:text-blue-400 mb-1">ساعت شروع</label>
                  <input type="time" value={manualStartTime} onChange={e => { setManualStartTime(e.target.value); setStartTime(e.target.value); }}
                    className="w-full p-2 border border-blue-300 dark:border-blue-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-blue-600 dark:text-blue-400 mb-1">ساعت پایان</label>
                  <input type="time" value={manualEndTime} onChange={e => { setManualEndTime(e.target.value); setEndTime(e.target.value); }}
                    className="w-full p-2 border border-blue-300 dark:border-blue-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Subject */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">موضوع جلسه</label>
          <input required type="text" value={subject} onChange={e => setSubject(e.target.value)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">محل برگزاری</label>
            <input required type="text" value={location} onChange={e => setLocation(e.target.value)}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
          </div>
          <div className="relative" ref={repPickerRef}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نماینده</label>
            <div className="relative">
              <input required type="text" value={representative}
                onChange={e => { setRepresentative(e.target.value); setRepFromContacts(false); }}
                className="w-full p-2 pl-9 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
              <button type="button" onClick={() => { setShowRepPicker(v => !v); setRepPickerSearch(''); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-blue-600 transition-colors"
                title="انتخاب از مخاطبین">
                <BookUser className="w-4 h-4" />
              </button>
            </div>
            {showRepPicker && (
              <div className="absolute z-30 left-0 right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl">
                <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                  <input autoFocus type="text" value={repPickerSearch} onChange={e => setRepPickerSearch(e.target.value)}
                    placeholder="جستجو در مخاطبین..."
                    className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {allContacts.filter(c => c.name.toLowerCase().includes(repPickerSearch.toLowerCase()) || ((c as any).phone || '').includes(repPickerSearch)).length === 0
                    ? <div className="p-3 text-sm text-gray-400 text-center">مخاطبی یافت نشد</div>
                    : allContacts.filter(c => c.name.toLowerCase().includes(repPickerSearch.toLowerCase()) || ((c as any).phone || '').includes(repPickerSearch)).map(c => (
                      <button key={c.id} type="button"
                        onClick={() => { setRepresentative(c.name); setPhone((c as any).phone || ''); setRepFromContacts(true); setShowRepPicker(false); }}
                        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-colors">
                        <span className="font-medium dark:text-white">{c.name}</span>
                        {(c as any).phone && <span className="text-xs text-gray-400 ltr">{(c as any).phone}</span>}
                      </button>
                    ))
                  }
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شماره تماس</label>
            <input required type="tel" value={phone} onChange={e => { setPhone(e.target.value); setRepFromContacts(false); }}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اولویت</label>
            <select value={priority} onChange={e => setPriority(e.target.value)}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
              <option value="high">بالا</option>
              <option value="medium">متوسط</option>
              <option value="low">پایین</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">یادداشت‌ها</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white resize-none" />
        </div>

        {/* Participants — tags inside input */}
        <MultiSelectField
          label="شرکت‌کنندگان جلسه"
          icon={<Users className="w-4 h-4" />}
          placeholder="جستجوی کاربران..."
          options={[]}
          groups={systemUserGroups}
          selected={selectedParticipants}
          onAdd={item => setSelectedParticipants(p => [...p, item])}
          onRemove={id => setSelectedParticipants(p => p.filter(x => x.id !== id))}
          tagColor="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300"
        />

        {/* Notify Users — tags inside input */}
        <MultiSelectField
          label="مطلعین جلسه"
          icon={<Bell className="w-4 h-4" />}
          placeholder="جستجوی کاربران..."
          options={[]}
          groups={systemUserGroups}
          selected={selectedNotifyUsers}
          onAdd={item => setSelectedNotifyUsers(p => [...p, item])}
          onRemove={id => setSelectedNotifyUsers(p => p.filter(x => x.id !== id))}
          tagColor="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
        />

        {/* External Participants — tags inside input */}
        <div ref={externalSearchRef}>
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
                <button type="button" onClick={e => { e.stopPropagation(); setSelectedExternal(prev => prev.filter(x => x !== name)); }} className="hover:opacity-70">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              type="text"
              value={externalSearch}
              onChange={e => { setExternalSearch(e.target.value); setShowExternalDropdown(true); }}
              onFocus={() => setShowExternalDropdown(true)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (filteredExternal.length > 0) {
                    setSelectedExternal(prev => [...prev, filteredExternal[0].name]);
                    setExternalSearch('');
                    setShowExternalDropdown(false);
                  }
                } else if (e.key === 'Escape') {
                  setShowExternalDropdown(false);
                }
              }}
              placeholder={selectedExternal.length === 0 ? 'جستجوی مخاطبین...' : ''}
              className="flex-1 min-w-[120px] outline-none bg-transparent text-sm dark:text-white placeholder-gray-400"
            />
          </div>
          {showExternalDropdown && (
            <div className="relative z-20">
              <div className="absolute w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-44 overflow-y-auto">
                {filteredExternal.slice(0, 8).map(c => (
                  <button key={c.id} type="button"
                    onClick={() => { setSelectedExternal(prev => [...prev, c.name]); setExternalSearch(''); setShowExternalDropdown(false); }}
                    className="w-full text-right px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-600 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0">
                    <span>{c.name}</span><span className="text-xs text-gray-400">{c.sub}</span>
                  </button>
                ))}
                {externalSearch && (
                  <button type="button" onClick={() => { setShowAddExternal(true); setShowExternalDropdown(false); }}
                    className="w-full text-right px-3 py-2 hover:bg-green-50 dark:hover:bg-green-900/20 text-sm text-green-600 flex items-center gap-2 border-t border-gray-200 dark:border-gray-600">
                    <Plus className="w-4 h-4" />افزودن مخاطب جدید
                  </button>
                )}
                {filteredExternal.length === 0 && !externalSearch && (
                  <div className="p-3 text-sm text-gray-400">مخاطبی یافت نشد</div>
                )}
              </div>
            </div>
          )}
          {showAddExternal && (
            <div className="mt-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
              <div className="space-y-2 mb-2">
                <input type="text" value={newExternalName} onChange={e => setNewExternalName(e.target.value)}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="نام مخاطب" />
                <div className="flex gap-2">
                  <input type="tel" value={newExternalPhone} onChange={e => setNewExternalPhone(e.target.value)}
                    className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="شماره موبایل" />
                  <input type="email" value={newExternalEmail} onChange={e => setNewExternalEmail(e.target.value)}
                    className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="ایمیل (اختیاری)" />
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={addQuickExternal} className="px-3 py-1.5 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600">ذخیره و افزودن</button>
                <button type="button" onClick={() => { setShowAddExternal(false); setNewExternalName(''); setNewExternalEmail(''); setNewExternalPhone(''); }} className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm">انصراف</button>
              </div>
            </div>
          )}
        </div>

        {/* Meeting Manager */}
        {selectedParticipants.length > 0 && (
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              <UserCheck className="w-4 h-4" />مدیر جلسه
            </label>
            <select value={meetingManager} onChange={e => setMeetingManager(e.target.value)}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
              <option value="">بدون مدیر</option>
              {selectedParticipants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}

        {/* Repeat */}
        <div className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-2 mb-2">
            <input type="checkbox" id="calRepeat" checked={repeatEnabled} onChange={e => setRepeatEnabled(e.target.checked)} className="w-4 h-4 text-blue-600 rounded" />
            <label htmlFor="calRepeat" className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <Repeat className="w-4 h-4" />تکرار جلسه
            </label>
          </div>
          {repeatEnabled && (
            <div className="space-y-3 mt-3">
              {/* Type + Interval row */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">نوع تکرار</label>
                  <select value={repeatType} onChange={e => setRepeatType(e.target.value as any)}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
                    <option value="weekly">هفتگی</option><option value="monthly">ماهیانه</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">هر چند</label>
                  <select value={repeatInterval} onChange={e => setRepeatInterval(Number(e.target.value))}
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
                    {[1,2,3,4].map(n => <option key={n} value={n}>هر {n} {repeatType==='weekly'?'هفته':'ماه'}</option>)}
                  </select>
                </div>
              </div>
              {/* End date */}
              <div className="relative">
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">تا تاریخ (شمسی)</label>
                <div className="flex gap-1">
                  <input type="text" value={repeatEndDate} onChange={e => setRepeatEndDate(e.target.value)} placeholder="مثال: ۱۴۰۵/۰۶/۳۱"
                    className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                  <button type="button" onClick={() => setShowEndDatePicker(!showEndDatePicker)}
                    className="px-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                    <Calendar className="w-4 h-4 text-gray-500" />
                  </button>
                </div>
                {showEndDatePicker && (
                  <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-600 p-3 w-64">
                    <div className="flex items-center justify-between mb-2">
                      <button type="button" onClick={() => { if(endDatePickerJm>1)setEndDatePickerJm(m=>m-1); else{setEndDatePickerJm(12);setEndDatePickerJy(y=>y-1);} }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ChevronRight className="w-4 h-4 dark:text-white" /></button>
                      <span className="text-sm font-semibold dark:text-white">{JALAALI_MONTHS[endDatePickerJm-1]} {endDatePickerJy}</span>
                      <button type="button" onClick={() => { if(endDatePickerJm<12)setEndDatePickerJm(m=>m+1); else{setEndDatePickerJm(1);setEndDatePickerJy(y=>y+1);} }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ChevronLeft className="w-4 h-4 dark:text-white" /></button>
                    </div>
                    <div className="grid grid-cols-7 gap-0.5">
                      {['ش','ی','د','س','چ','پ','ج'].map(d => <div key={d} className="text-center text-[10px] text-gray-400 py-0.5">{d}</div>)}
                      {(() => {
                        const dim = endDatePickerJm<=6?31:endDatePickerJm<=11?30:29;
                        const fd = moment(`${endDatePickerJy}/${endDatePickerJm}/1`,'jYYYY/jM/jD').day();
                        const off = fd===6?0:fd+1;
                        const cells: React.ReactNode[] = [];
                        for(let i=0;i<off;i++) cells.push(<div key={`e${i}`}/>);
                        for(let d=1;d<=dim;d++){
                          const jd=`${endDatePickerJy}/${String(endDatePickerJm).padStart(2,'0')}/${String(d).padStart(2,'0')}`;
                          cells.push(<button key={d} type="button" onClick={()=>{setRepeatEndDate(jd);setShowEndDatePicker(false);}} className={`text-xs py-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors ${repeatEndDate===jd?'bg-blue-500 text-white':'dark:text-white'}`}>{d}</button>);
                        }
                        return cells;
                      })()}
                    </div>
                  </div>
                )}
              </div>
              {/* Weekly: day picker */}
              {repeatType==='weekly' && (
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">روز هفته</label>
                  <div className="flex flex-wrap gap-1.5">
                    {JALAALI_WEEKDAYS.map((day,i)=>(
                      <button key={i} type="button" onClick={()=>setRepeatWeekday(i)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${repeatWeekday===i?'bg-blue-500 text-white':'bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 text-gray-600 dark:text-gray-300 hover:border-blue-400'}`}>
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Monthly: mode picker */}
              {repeatType==='monthly' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">نوع تکرار ماهیانه</label>
                    <div className="flex gap-2">
                      {[
                        {v:'specific',l:scheduleDate?`روز ${scheduleDate.jd} هر ماه`:'همان روز ماه'},
                        {v:'nth',l:(() => {
                          if (!scheduleDate) return 'روز هفته ماه';
                          const jsDay = moment(`${scheduleDate.jy}/${scheduleDate.jm}/${scheduleDate.jd}`,'jYYYY/jM/jD').day();
                          const jsDayMap = [6,0,1,2,3,4,5];
                          const wdIdx = jsDayMap.indexOf(jsDay);
                          const wdName = wdIdx >= 0 ? JALAALI_WEEKDAYS[wdIdx] : '';
                          const nthLabels = ['','اول','دوم','سوم','چهارم'];
                          const nth = Math.ceil(scheduleDate.jd / 7);
                          return wdName ? `${nthLabels[Math.min(nth,4)]} ${wdName} ماه` : 'روز هفته ماه';
                        })()},
                      ].map(opt=>(
                        <button key={opt.v} type="button"
                          onClick={()=>{
                            setRepeatMonthlyMode(opt.v as any);
                            if (opt.v === 'nth' && scheduleDate) {
                              const jsDay = moment(`${scheduleDate.jy}/${scheduleDate.jm}/${scheduleDate.jd}`,'jYYYY/jM/jD').day();
                              const jsDayMapInner = [6,0,1,2,3,4,5];
                              const wdIdx = jsDayMapInner.indexOf(jsDay);
                              if (wdIdx >= 0) setRepeatMonthlyNthWeekday(wdIdx);
                              setRepeatMonthlyNth(Math.min(Math.ceil(scheduleDate.jd / 7), 4));
                            }
                          }}
                          className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${repeatMonthlyMode===opt.v?'bg-blue-500 text-white':'bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 text-gray-600 dark:text-gray-300'}`}>
                          {opt.l}
                        </button>
                      ))}
                    </div>
                  </div>
                  {repeatMonthlyMode==='nth' && (
                    <div className="space-y-2">
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">کدام هفته ماه</label>
                        <div className="flex gap-1.5 flex-wrap">
                          {[{v:1,l:'اول'},{v:2,l:'دوم'},{v:3,l:'سوم'},{v:4,l:'چهارم'},{v:-1,l:'آخر'}].map(opt=>(
                            <button key={opt.v} type="button" onClick={()=>setRepeatMonthlyNth(opt.v)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${repeatMonthlyNth===opt.v?'bg-blue-500 text-white':'bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 text-gray-600 dark:text-gray-300 hover:border-blue-400'}`}>
                              {opt.l}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">روز هفته</label>
                        <div className="flex flex-wrap gap-1.5">
                          {JALAALI_WEEKDAYS.map((day,i)=>(
                            <button key={i} type="button" onClick={()=>setRepeatMonthlyNthWeekday(i)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${repeatMonthlyNthWeekday===i?'bg-blue-500 text-white':'bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 text-gray-600 dark:text-gray-300 hover:border-blue-400'}`}>
                              {day}
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Summary */}
                      <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-xs text-blue-700 dark:text-blue-300 text-center font-medium">
                        {repeatMonthlyNth === -1 ? 'آخرین' : ['','اول','دوم','سوم','چهارم'][repeatMonthlyNth] || ''} {JALAALI_WEEKDAYS[repeatMonthlyNthWeekday]} هر ماه
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Reminder */}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            <Bell className="w-4 h-4" />یادآوری
          </label>
          <select value={reminderMinutes} onChange={e => setReminderMinutes(Number(e.target.value))}
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
        <div className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-200 dark:border-gray-600">
          <div className="flex items-center gap-2 mb-2">
            <input type="checkbox" id="calAgenda" checked={agendaEnabled} onChange={e => setAgendaEnabled(e.target.checked)} className="w-4 h-4 text-blue-600 rounded" />
            <label htmlFor="calAgenda" className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <ClipboardList className="w-4 h-4" />دستور جلسه
            </label>
          </div>
          {agendaEnabled && (
            <div className="space-y-2 mt-3">
              {agendaItems.map((item, idx) => (
                <div key={idx} className="flex items-start gap-2 p-2.5 bg-white dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
                  <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.title}</p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      {item.presenter && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <UserCheck className="w-3 h-3" />{item.presenter}
                        </span>
                      )}
                      {item.duration_minutes && (
                        <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                          <Clock className="w-3 h-3" />{item.duration_minutes} دقیقه
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button type="button" onClick={() => { setAgendaForm({ title: item.title, presenter: item.presenter || '', duration_minutes: item.duration_minutes ? String(item.duration_minutes) : '' }); setEditingAgendaIdx(idx); setShowAgendaForm(true); }}
                      className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => setAgendaItems(prev => prev.filter((_, i) => i !== idx))}
                      className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-400 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {showAgendaForm ? (
                <div className="p-3 bg-white dark:bg-gray-700 rounded-lg border border-blue-200 dark:border-blue-700 space-y-2">
                  <input type="text" value={agendaForm.title} onChange={e => setAgendaForm(f => ({ ...f, title: e.target.value }))}
                    placeholder="عنوان آیتم دستور جلسه *"
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-600 dark:text-white text-sm" />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">ارائه‌دهنده</label>
                      <select value={agendaForm.presenter} onChange={e => setAgendaForm(f => ({ ...f, presenter: e.target.value }))}
                        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-600 dark:text-white text-sm">
                        <option value="">بدون ارائه‌دهنده</option>
                        {selectedParticipants.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                        {selectedExternal.map(name => <option key={name} value={name}>{name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">مدت (دقیقه)</label>
                      <input type="number" min="1" value={agendaForm.duration_minutes} onChange={e => setAgendaForm(f => ({ ...f, duration_minutes: e.target.value }))}
                        placeholder="مثلاً ۱۵"
                        className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-600 dark:text-white text-sm" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button"
                      onClick={() => {
                        if (!agendaForm.title.trim()) return;
                        const newItem: AgendaItem = {
                          id: crypto.randomUUID(),
                          meeting_id: prefillMeetingId || '',
                          title: agendaForm.title.trim(),
                          presenter: agendaForm.presenter || null,
                          duration_minutes: agendaForm.duration_minutes ? Number(agendaForm.duration_minutes) : null,
                          sort_order: editingAgendaIdx !== null ? editingAgendaIdx : agendaItems.length,
                        };
                        if (editingAgendaIdx !== null) {
                          setAgendaItems(prev => prev.map((it, i) => i === editingAgendaIdx ? newItem : it));
                        } else {
                          setAgendaItems(prev => [...prev, newItem]);
                        }
                        setAgendaForm({ title: '', presenter: '', duration_minutes: '' });
                        setEditingAgendaIdx(null);
                        setShowAgendaForm(false);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded-lg text-sm hover:bg-blue-600 transition-colors">
                      <Check className="w-3.5 h-3.5" />{editingAgendaIdx !== null ? 'ویرایش' : 'افزودن'}
                    </button>
                    <button type="button" onClick={() => { setShowAgendaForm(false); setAgendaForm({ title: '', presenter: '', duration_minutes: '' }); setEditingAgendaIdx(null); }}
                      className="px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors">
                      انصراف
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button"
                  onClick={() => { setShowAgendaForm(true); setEditingAgendaIdx(null); setAgendaForm({ title: '', presenter: '', duration_minutes: '' }); }}
                  className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors">
                  <Plus className="w-4 h-4" />افزودن آیتم دستور جلسه
                </button>
              )}
            </div>
          )}
        </div>

        {/* Online meeting toggle */}
        <div className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border transition-colors ${isOnline ? 'bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-700' : 'bg-gray-50 dark:bg-gray-700/30 border-gray-200 dark:border-gray-600'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${isOnline ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
              <Video className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className={`text-sm font-medium ${isOnline ? 'text-sky-800 dark:text-sky-200' : 'text-gray-700 dark:text-gray-300'}`}>
                این جلسه به صورت آنلاین برگزار می‌گردد
              </p>
              <p className={`text-xs mt-0.5 ${isOnline ? 'text-sky-600 dark:text-sky-400' : 'text-gray-400 dark:text-gray-500'}`}>
                {isOnline ? 'اتاق ویدیو کنفرانس اتوماتیک ایجاد می‌شود' : 'غیرفعال — جلسه حضوری'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOnline(v => !v)}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${isOnline ? 'bg-sky-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isOnline ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* SMS + save contact */}
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={sendSms} onChange={e=>setSendSms(e.target.checked)} className="w-4 h-4 rounded text-blue-600" />
            <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1.5"><MessageSquare className="w-4 h-4" />ارسال پیامک</span>
          </label>
          {!repFromContacts && representative.trim() && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={saveContact} onChange={e=>setSaveContact(e.target.checked)} className="w-4 h-4 rounded text-blue-600" />
              <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1.5"><Save className="w-4 h-4" />ذخیره اطلاعات تماس در دفترچه</span>
            </label>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
        <button type="submit" disabled={loading || orgUsersLoading}
          className="flex-1 flex items-center justify-center gap-2 bg-teal-600 text-white py-2.5 rounded-xl hover:bg-teal-700 disabled:opacity-50 font-medium text-sm transition-colors">
          {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlusCircle className="w-5 h-5" />}
          ثبت نهایی جلسه
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors">
          انصراف
        </button>
      </div>
    </form>
  );
}
