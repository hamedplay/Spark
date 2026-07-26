import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { insertNotification, getSmsTemplates, fillPlaceholders } from '../lib/notifications';
import type { SmsDispatchResult } from '../lib/notifications';
import { getMeetingTemplateKey, type MeetingRecipientRole, type MeetingAction } from '../config/templateCatalog';
import {
  computeMeetingChangeSet,
  computeParticipantDiff,
  computeObserverDiff,
  computeExternalDiff,
  buildMeetingNotificationPlan,
  normalizeExternalName,
} from '../lib/meetingEditDiff';
import type { MeetingChangeSet, ParticipantDiff, ObserverDiff, ExternalDiff, NotificationPlan } from '../lib/meetingEditDiff';
import { Bell, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';
import { ContactEmail, AgendaItem } from '../types';
import { useOrgUsers, FALLBACK_NAME, LOADING_NAME } from '../lib/useOrgUsers';
import { MultiSelectField } from './CalendarMeetingForm/MultiSelectField';
import { FormHeader } from './CalendarMeetingForm/FormHeader';
import { FormFooter } from './CalendarMeetingForm/FormFooter';
import { EditDecisionModal } from './CalendarMeetingForm/EditDecisionModal';
import { CalendarSelectorSection } from './CalendarMeetingForm/CalendarSelectorSection';
import { DateTimeSection } from './CalendarMeetingForm/DateTimeSection';
import { CoreFieldsSection } from './CalendarMeetingForm/CoreFieldsSection';
import { ExternalParticipantsSection } from './CalendarMeetingForm/ExternalParticipantsSection';
import { MeetingManagerSection } from './CalendarMeetingForm/MeetingManagerSection';
import { RepeatSection } from './CalendarMeetingForm/RepeatSection';
import { ReminderSection } from './CalendarMeetingForm/ReminderSection';
import { AgendaSection } from './CalendarMeetingForm/AgendaSection';
import { OnlineMeetingSection, SmsOptionsSection } from './CalendarMeetingForm/OptionsSections';

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
  eventType: 'invite' | 'change' | 'cancel' = 'invite',
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
      smsTemplates.get(`meeting:${eventType}:external`) ||
      smsTemplates.get(`meeting:${eventType}:all`) ||
      (eventType === 'change'
        ? smsTemplates.get('meeting:invite:external') || smsTemplates.get('meeting:invite:all')
        : undefined);
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
        eventType,
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

export type CommitSnapshot = {
  operationId: string;
  updateRecord: Record<string, any>;
  baseFields: Record<string, any> | null;
  isFirstSchedule: boolean;
  senderName: string;
  meetingDateStr: string;
  meetingTimeStr: string;
  smsPlaceholders: Record<string, string>;
  agendaSummary: string;
  participantNameMap: Record<string, string>;
  observerIds: string[];
  prevNotifyUserIds: string[];
  previousNotifyUserIdsByMeetingId: Record<string, string[]>;
  changeSetsByMeetingId: Record<string, MeetingChangeSet>;
  prevAgendaByMeetingId: Record<string, AgendaItem[]>;
  joinLink: string;
  gregDate: string;
  selectedParticipantIds: string[];
  selectedExternal: string[];
  sendSms: boolean;
  agendaEnabled: boolean;
  agendaItems: AgendaItem[];
  prevExternalByMeetingId: Record<string, string[]>;
  isOnline: boolean;
  wasOnline: boolean;
  prevRoomId: string | null;
  prevParticipantIds: string[];
  prevObserverIds: string[];
};

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
  // Edit notification decision modal (two-phase submit: prepare -> commit)
  const [editDecision, setEditDecision] = useState<null | {
    changeSet: MeetingChangeSet;
    snapshot: CommitSnapshot;
  }>(null);
  const [committing, setCommitting] = useState(false);

  const [agendaEnabled, setAgendaEnabled] = useState(false);
  const [agendaItems, setAgendaItems] = useState<AgendaItem[]>([]);
  const [showAgendaForm, setShowAgendaForm] = useState(false);
  const [agendaForm, setAgendaForm] = useState<{ title: string; presenter: string; duration_minutes: string; description: string }>({ title: '', presenter: '', duration_minutes: '', description: '' });
  const [editingAgendaIdx, setEditingAgendaIdx] = useState<number | null>(null);

  // Org users for grouped pickers
  const { groups: orgGroups, allUsers: orgAllUsers, loading: orgUsersLoading, usersById } = useOrgUsers(userId);

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

  // Display names are derived at render time from the org directory (usersById),
  // never stored as fallback strings in state. State holds only IDs (+ a vestigial
  // name used solely as a secondary fallback for users absent from the directory).
  const isPlaceholderName = (name: string): boolean => {
    const trimmed = name.trim();
    if (!trimmed) return true;
    if (trimmed === 'همکار گرامی' || trimmed === FALLBACK_NAME || trimmed === LOADING_NAME) return true;
    // UUID or email are not valid display names
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return true;
    if (/^\S+@\S+\.\S+$/.test(trimmed)) return true;
    return false;
  };

  const resolveDisplayName = (uid: string, storedName?: string): string => {
    if (orgUsersLoading) return LOADING_NAME;
    const user = usersById[uid];
    if (user?.full_name?.trim()) return user.full_name.trim();
    if (storedName && !isPlaceholderName(storedName)) return storedName;
    return FALLBACK_NAME;
  };

  // Derived display items — the single source of truth for rendered names
  const participantDisplayItems = useMemo(
    () => selectedParticipants.map(p => ({ id: p.id, name: resolveDisplayName(p.id, p.name) })),
    [selectedParticipants, usersById, orgUsersLoading],
  );
  const notifyDisplayItems = useMemo(
    () => selectedNotifyUsers.map(u => ({ id: u.id, name: resolveDisplayName(u.id, u.name) })),
    [selectedNotifyUsers, usersById, orgUsersLoading],
  );
  const managerDisplayName = useMemo(
    () => meetingManager ? resolveDisplayName(meetingManager) : '',
    [meetingManager, usersById, orgUsersLoading],
  );

  // Resolve a user's name for notification payloads (same source as display)
  const resolveUserName = (uid: string): string => resolveDisplayName(uid);

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
      setSelectedParticipants(prefillData.participantUserIds.map((id: string) => ({ id, name: '' })));
    }
  }, [prefillData]);

  const loadMeetingParticipants = async (meetingId: string) => {
    const { data } = await supabase.from('meetings').select('participant_user_ids, notify_users, external_participants, meeting_manager, is_online, conference_room_id').eq('id', meetingId).maybeSingle();
    if (!data) return;
    if (data.is_online !== undefined && data.is_online !== null) setIsOnline(!!data.is_online);

    if ((data.participant_user_ids || []).length > 0) {
      setSelectedParticipants((data.participant_user_ids as string[]).map((id: string) => ({ id, name: '' })));
    }
    if ((data.notify_users || []).length > 0) {
      const notifyIds = (data.notify_users as string[]);
      // Exclude the current user (creator) from the visible notify list since they're auto-included
      setSelectedNotifyUsers(notifyIds.map((id: string) => ({ id, name: '' })));
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

      // Create conference room ONLY for new meetings (Create flow), not Edit.
      // In Edit, room creation happens in commitEdit after user confirms.
      let conferenceRoomId: string | null = null;
      let conferenceRoomCode: string | null = null;
      if (!prefillMeetingId && isOnline) {
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
      // For Create flow, only next recipients are needed.
      // For Edit flow, we also need names for previously selected users who may be removed.
      let prevParticipantIds: string[] = [];
      let prevObserverIds: string[] = [];
      if (prefillMeetingId) {
        const bulkIds = (prefillEditAllIds && prefillEditAllIds.length > 0) ? prefillEditAllIds : [prefillMeetingId];
        const { data: existingRows } = await supabase
          .from('meetings')
          .select('id, participant_user_ids, notify_users')
          .in('id', bulkIds);
        for (const r of (existingRows || [])) {
          for (const uid of (r.participant_user_ids || [])) {
            if (uid && uid !== userId) prevParticipantIds.push(uid);
          }
          for (const uid of (r.notify_users || [])) {
            if (uid && uid !== userId) prevObserverIds.push(uid);
          }
        }
        prevParticipantIds = [...new Set(prevParticipantIds)];
        prevObserverIds = [...new Set(prevObserverIds)];
      }
      const allRecipientIds = [...new Set([...participantIds, ...observerIds, ...prevParticipantIds, ...prevObserverIds])];
      for (const uid of allRecipientIds) {
        participantNameMap[uid] = resolveUserName(uid);
      }

      if (prefillMeetingId) {
        // --- Prepare phase: fetch existing meeting(s), compute ChangeSet, decide ---
        const bulkIds = (prefillEditAllIds && prefillEditAllIds.length > 0) ? prefillEditAllIds : [prefillMeetingId];
        const { data: existingRows } = await supabase
          .from('meetings')
          .select('id, subject, request_date, start_time, end_time, location, representative, phone, notes, priority, meeting_manager, is_online, conference_room_id, participant_user_ids, notify_users, external_participants, reminder_minutes, calendar_id, send_sms, members_only, repeat_type, repeat_interval, repeat_end_date, repeat_weekday')
          .in('id', bulkIds);
        const existingMap = new Map<string, any>();
        for (const r of (existingRows || [])) existingMap.set(r.id, r);
        // Fetch agenda items separately (separate table) so computeChangeSet can diff them.
        const { data: prevAgendaRows, error: prevAgendaError } = await supabase
          .from('meeting_agenda_items')
          .select('meeting_id, title, presenter, duration_minutes, sort_order')
          .in('meeting_id', bulkIds)
          .order('sort_order');
        if (prevAgendaError) throw new Error('خطا در آماده‌سازی ویرایش جلسه؛ لطفاً دوباره تلاش کنید');
        const prevAgendaByMeetingId: Record<string, AgendaItem[]> = {};
        for (const a of (prevAgendaRows ?? [])) {
          const row = existingMap.get(a.meeting_id);
          if (!row) continue;
          if (!row.agenda_items) row.agenda_items = [];
          row.agenda_items.push({ title: a.title, presenter: a.presenter, duration_minutes: a.duration_minutes });
          if (!prevAgendaByMeetingId[a.meeting_id]) prevAgendaByMeetingId[a.meeting_id] = [];
          prevAgendaByMeetingId[a.meeting_id].push({ title: a.title, presenter: a.presenter, duration_minutes: a.duration_minutes });
        }
        const existingMtg = existingMap.get(prefillMeetingId) || null;
        const isFirstSchedule = !existingMtg?.start_time;

        // Conference room: in prepare phase, just load existing state. NO room creation here.
        // Room creation happens in commitEdit ONLY after user confirms.
        const wasOnline = !!existingMtg?.is_online;
        const prevRoomId = existingMtg?.conference_room_id || null;
        if (isOnline && wasOnline && prevRoomId) {
          // staying online: preserve existing room, fetch code for joinLink
          conferenceRoomId = prevRoomId;
          const { data: roomRow } = await supabase.from('conference_rooms').select('code').eq('id', prevRoomId).maybeSingle();
          conferenceRoomCode = roomRow?.code || null;
        } else if (isOnline && !wasOnline) {
          // offline→online: DON'T create room yet. Will be created in commitEdit.
          conferenceRoomId = null;
          conferenceRoomCode = null;
        } else {
          // going offline: clear room association
          conferenceRoomId = null;
          conferenceRoomCode = null;
        }
        const editJoinLink = conferenceRoomCode
          ? `${window.location.origin}?conference=${conferenceRoomCode}`
          : '';

        const nextFields: Record<string, any> = {
          subject, request_date: gregDate, start_time: startTime, end_time: endTime,
          location, representative, phone, notes: notes || null, priority,
          meeting_manager: meetingManager || null, is_online: isOnline,
          conference_room_id: conferenceRoomId,
          participant_user_ids: selectedParticipants.map(p => p.id),
          notify_users: Array.from(new Set([userId, ...selectedNotifyUsers.map(u => u.id)])),
          external_participants: selectedExternal,
          reminder_minutes: reminderMinutes || null,
          calendar_id: selectedCalendarId || null,
          send_sms: sendSms,
          members_only: (selectedParticipants.length > 0 || selectedNotifyUsers.filter(u => u.id !== userId).length > 0)
            ? true
            : ((selectedCalendarId && selectedCalendar?.type === 'shared') ? membersOnly : false),
          repeat_type: repeatEnabled ? repeatType : 'none',
          repeat_interval: repeatEnabled ? repeatInterval : null,
          repeat_end_date: repeatEnabled ? repeatEndDate : null,
          repeat_weekday: repeatEnabled && repeatType === 'weekly' ? repeatWeekday : null,
          agenda_items: agendaEnabled ? agendaItems : [],
        };

        // Aggregate ChangeSet across ALL meetings in a bulk edit so the decision modal
        // reflects the true scope of changes, not just the first meeting.
        // Also keep per-meeting ChangeSet so commit can gate change notifications per-meeting.
        const changeSetsByMeetingId: Record<string, MeetingChangeSet> = {};
        const aggregatedChangeSet: MeetingChangeSet = {
          importantFields: [], minorFields: [],
          participantChanged: false, notifyUsersChanged: false, externalChanged: false,
          hasNonParticipantChanges: false, hasAnyChanges: false,
        };
        const importantSet = new Set<string>();
        const minorSet = new Set<string>();
        for (const id of bulkIds) {
          const ex = existingMap.get(id) || {};
          const cs = computeMeetingChangeSet(ex, nextFields);
          changeSetsByMeetingId[id] = cs;
          for (const f of cs.importantFields) importantSet.add(f);
          for (const f of cs.minorFields) minorSet.add(f);
          if (cs.participantChanged) aggregatedChangeSet.participantChanged = true;
          if (cs.notifyUsersChanged) aggregatedChangeSet.notifyUsersChanged = true;
          if (cs.externalChanged) aggregatedChangeSet.externalChanged = true;
          if (cs.hasNonParticipantChanges) aggregatedChangeSet.hasNonParticipantChanges = true;
          if (cs.hasAnyChanges) aggregatedChangeSet.hasAnyChanges = true;
        }
        aggregatedChangeSet.importantFields = [...importantSet];
        aggregatedChangeSet.minorFields = [...minorSet];
        const changeSet = aggregatedChangeSet;

        if (!changeSet.hasAnyChanges) {
          toast('تغییری شناسایی نشد');
          return;
        }

        const updateRecord: any = {
          subject, request_date: gregDate,
          duration: startTime && endTime ? `${startTime} - ${endTime}` : '',
          start_time: startTime, end_time: endTime,
          location, representative, phone, notes: notes || null, priority,
          status: 'archived', status_type: 'scheduled',
          notify_users: Array.from(new Set([userId, ...selectedNotifyUsers.map(u => u.id)])),
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

        let baseFields: Record<string, any> | null = null;
        if (prefillEditAllIds && prefillEditAllIds.length > 0) {
          baseFields = { subject, location, representative, phone, notes: notes || null, priority,
            start_time: startTime, end_time: endTime,
            duration: startTime && endTime ? `${startTime} - ${endTime}` : '',
            status: 'archived', status_type: 'scheduled',
            notify_users: updateRecord.notify_users,
            external_participants: selectedExternal,
            repeat_type: updateRecord.repeat_type, repeat_interval: updateRecord.repeat_interval,
            repeat_end_date: updateRecord.repeat_end_date, repeat_weekday: updateRecord.repeat_weekday,
            reminder_minutes: reminderMinutes || null,
            send_sms: sendSms, meeting_manager: meetingManager || null,
            calendar_id: selectedCalendarId || null,
            members_only: updateRecord.members_only, is_online: isOnline,
            conference_room_id: conferenceRoomId,
          };
        }

        const operationId = (crypto as any)?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const snapshot: CommitSnapshot = {
          operationId,
          updateRecord, baseFields, isFirstSchedule, senderName,
          meetingDateStr, meetingTimeStr, smsPlaceholders, agendaSummary,
          participantNameMap, observerIds,
          prevNotifyUserIds: (existingMtg?.notify_users || []).filter((x: string) => x && x !== userId),
          previousNotifyUserIdsByMeetingId: Object.fromEntries(
            bulkIds.map((id: string) => [
              id,
              ((existingMap.get(id)?.notify_users || []) as string[]).filter((x: string) => x && x !== userId),
            ])
          ),
          changeSetsByMeetingId,
          prevAgendaByMeetingId,
          joinLink: editJoinLink, gregDate,
          selectedParticipantIds: selectedParticipants.map(p => p.id),
          selectedExternal, sendSms, agendaEnabled, agendaItems,
          prevExternalByMeetingId: Object.fromEntries(
            bulkIds.map((id: string) => [
              id,
              ((existingMap.get(id)?.external_participants || []) as string[]).filter((x: string) => !!x),
            ])
          ),
          isOnline,
          wasOnline,
          prevRoomId,
          prevParticipantIds,
          prevObserverIds,
        };

        if (changeSet.hasAnyChanges) {
          // Open decision modal for ANY real change; commit deferred to user choice
          setEditDecision({ changeSet, snapshot });
          return;
        }
      } else {
        const { data: md, error: me } = await supabase.from('meetings').insert([record]).select().single();
        if (me) throw me;
        if (md) {
          if (selectedParticipants.length > 0) {
            await supabase.from('participants').insert(participantDisplayItems.map(p => ({ meeting_id: md.id, name: p.name })));
          }
          // Save agenda items
          if (agendaEnabled && agendaItems.length > 0) {
            await supabase.from('meeting_agenda_items').insert(
              agendaItems.map((item, idx) => ({
                meeting_id: md.id,
                title: item.title,
                presenter: item.presenter || null,
                duration_minutes: item.duration_minutes || null,
                description: ('description' in item ? String((item as Record<string, unknown>).description ?? '') : '') || null,
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

  const commitLockRef = useRef(false);
  const commitEdit = async (snapshot: CommitSnapshot, notifyExistingParticipants: boolean) => {
    if (!userId || !prefillMeetingId) return;
    if (commitLockRef.current) return;
    commitLockRef.current = true;
    setCommitting(true);
    const { operationId } = snapshot;
    try {
      const {
        updateRecord, baseFields, isFirstSchedule, senderName,
        meetingDateStr, meetingTimeStr, smsPlaceholders, agendaSummary,
        participantNameMap, observerIds, gregDate,
        selectedParticipantIds, selectedExternal, sendSms, agendaEnabled, agendaItems,
      } = snapshot;

      // 1. Update meeting details (participant_user_ids intentionally NOT included here)
      if (baseFields && prefillEditAllIds && prefillEditAllIds.length > 0) {
        const { error } = await supabase.from('meetings').update(baseFields).in('id', prefillEditAllIds);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('meetings').update(updateRecord).eq('id', prefillMeetingId);
        if (error) throw error;
      }

      // 1b. Conference room: create ONLY after successful save, only for offline→online transition.
      // If room creation fails, throw so the meeting doesn't end up with is_online=true and conference_room_id=null.
      if (snapshot.isOnline && !snapshot.wasOnline) {
        const room = await createConferenceRoom(subject);
        if (!room?.id) {
          throw new Error('خطا در ایجاد اتاق جلسه آنلاین؛ لطفاً دوباره تلاش کنید');
        }
        const { error: roomUpdateError } = await supabase.from('meetings').update({ conference_room_id: room.id }).eq('id', prefillMeetingId);
        if (roomUpdateError) throw roomUpdateError;
      }

      // 2. Save agenda items (delete + insert). Error aborts before any notifications.
      const { error: agendaDelError } = await supabase.from('meeting_agenda_items').delete().eq('meeting_id', prefillMeetingId);
      if (agendaDelError) throw new Error('خطا در ذخیره دستور جلسه؛ لطفاً دوباره تلاش کنید');
      if (agendaEnabled && agendaItems.length > 0) {
        const { error: agendaInsError } = await supabase.from('meeting_agenda_items').insert(
          agendaItems.map((item, idx) => ({
            meeting_id: prefillMeetingId,
            title: item.title,
            presenter: item.presenter || null,
            duration_minutes: item.duration_minutes || null,
            description: ('description' in item ? String((item as Record<string, unknown>).description ?? '') : '') || null,
            sort_order: idx,
          }))
        );
        if (agendaInsError) throw new Error('خطا در ذخیره دستور جلسه؛ لطفاً دوباره تلاش کنید');
      }

      // 3. Atomic participant sync via RPC; diff comes from RPC output, not frontend state
      type MeetingParticipantDiff = {
        meeting_id: string;
        added_participant_ids: string[];
        retained_participant_ids: string[];
        removed_participant_ids: string[];
      };
      let meetingDiffs: MeetingParticipantDiff[] = [];
      if (prefillEditAllIds && prefillEditAllIds.length > 0) {
        const { data: bulkResult, error: syncError } = await supabase.rpc('sync_meeting_participants_bulk_v2', {
          p_meeting_ids: prefillEditAllIds,
          p_participant_user_ids: selectedParticipantIds,
        });
        if (syncError) throw new Error(syncError.message || 'خطا در همگام‌سازی شرکت‌کنندگان');
        meetingDiffs = (bulkResult || []) as MeetingParticipantDiff[];
        if (import.meta.env?.DEV) {
          console.debug('[commitEdit] sync_meeting_participants_bulk_v2', {
            rawBulkResult: bulkResult,
            meetingDiffs,
          });
        }
      } else {
        const { data: syncResult, error: syncError } = await supabase.rpc('sync_meeting_participants_v2', {
          p_meeting_id: prefillMeetingId,
          p_participant_user_ids: selectedParticipantIds,
        });
        if (syncError) throw new Error(syncError.message || 'خطا در همگام‌سازی شرکت‌کنندگان');
        // RPC returns TABLE(...) → PostgREST wraps in array. Normalize to first row.
        const normalizedSyncResult = Array.isArray(syncResult) ? syncResult[0] : syncResult;
        if (import.meta.env?.DEV) {
          console.debug('[commitEdit] sync_meeting_participants_v2', {
            rawSyncResult: syncResult,
            normalizedSyncResult,
            isArray: Array.isArray(syncResult),
            added: normalizedSyncResult?.added_participant_ids ?? [],
            retained: normalizedSyncResult?.retained_participant_ids ?? [],
            removed: normalizedSyncResult?.removed_participant_ids ?? [],
          });
        }
        meetingDiffs = [{
          meeting_id: prefillMeetingId,
          added_participant_ids: (normalizedSyncResult?.added_participant_ids ?? []) as string[],
          retained_participant_ids: (normalizedSyncResult?.retained_participant_ids ?? []) as string[],
          removed_participant_ids: (normalizedSyncResult?.removed_participant_ids ?? []) as string[],
        }];
      }

      // 4. Notifications — only after successful save + sync, and only if user chose to notify.
      // In Edit flow, ALL notifications (including isFirstSchedule creator notification) are gated on notify flag.
      // Without notifications: meeting saved, participants/observers/inbox synced, toast shown, zero messages.
      const internalSmsResults: SmsDispatchResult[] = [];
      const externalSmsResults: ExternalSmsResult[] = [];

      if (import.meta.env?.DEV) {
        console.debug('[commitEdit] notification dispatch', {
          notifyExistingParticipants,
          operationId: snapshot.operationId,
          prefillMeetingId,
          selectedParticipantIds,
          prevParticipantIds: snapshot.prevParticipantIds,
          meetingDiffs,
          changeSetsByMeetingId: snapshot.changeSetsByMeetingId,
        });
      }

      if (!notifyExistingParticipants) {
        showSmsSummary(internalSmsResults, null);
        setEditDecision(null);
        onSuccess(subject, !!prefillMeetingId);
        return;
      }

      // Creator/editor notification: ONLY on first schedule (create flow), never on subsequent edits.
      // No SMS or Bale for creator — only in-app notification + toast.
      if (isFirstSchedule) {
        const creatorEventType = getMeetingTemplateKey('creator', 'created');
        await insertNotification({ userId, category: 'meeting', eventType: creatorEventType, fallbackTitle: 'جلسه زمان‌بندی شد', fallbackMessage: `جلسه "${subject}" زمان‌بندی شد${agendaSummary}`, placeholders: { ...smsPlaceholders, full_name: senderName, recipient_greeting: `${senderName} گرامی` }, senderId: userId, senderName: senderName, actionUrl: 'calendar', channels: { inApp: true, sms: false, bale: false }, eventKey: `${operationId}:${prefillMeetingId}:${userId}:creator:${creatorEventType}` });
      }

      const bulkMeetingDetails = new Map<string, { subject: string; request_date: string; start_time: string | null; end_time: string | null }>();
      if (meetingDiffs.length > 1) {
        const bulkIds = meetingDiffs.map(d => d.meeting_id);
        const { data: bulkMeetings } = await supabase
          .from('meetings')
          .select('id, subject, request_date, start_time, end_time')
          .in('id', bulkIds);
        for (const m of (bulkMeetings || [])) {
          bulkMeetingDetails.set(m.id, { subject: m.subject, request_date: m.request_date, start_time: m.start_time, end_time: m.end_time });
        }
      }

      const sentNotificationKeys = new Set<string>();

      for (const diff of meetingDiffs) {
        const isBulk = meetingDiffs.length > 1;
        const mtgSubject = isBulk ? (bulkMeetingDetails.get(diff.meeting_id)?.subject || subject) : subject;
        const mtgDate = isBulk ? (bulkMeetingDetails.get(diff.meeting_id)?.request_date || gregDate) : gregDate;
        const mtgStartTime = isBulk ? (bulkMeetingDetails.get(diff.meeting_id)?.start_time || startTime) : startTime;
        const mtgEndTime = isBulk ? (bulkMeetingDetails.get(diff.meeting_id)?.end_time || endTime) : endTime;
        const mtgTimeStr = mtgStartTime && mtgEndTime ? `${mtgStartTime}-${mtgEndTime}` : mtgStartTime || '';
        let mtgJalaaliDate = '';
        if (mtgDate) {
          try {
            const jMoment = moment(mtgDate);
            if (jMoment.isValid()) mtgJalaaliDate = jMoment.format('jYYYY/jMM/jDD');
          } catch { /* ignore parse error */ }
        }
        const mtgSmsPlaceholders: Record<string, string> = {
          ...smsPlaceholders,
          meeting_subject: mtgSubject,
          meeting_date: mtgJalaaliDate,
          start_time: mtgStartTime || '',
          end_time: mtgEndTime || '',
          meeting_time: mtgTimeStr,
        };

        const mtgChangeSet = snapshot.changeSetsByMeetingId[diff.meeting_id];
        // Added participants → invite only
        if (diff.added_participant_ids.length) {
          const addedEventType = getMeetingTemplateKey('participant', 'invite');
          for (const uid of diff.added_participant_ids) {
            const dedupeKey = `${operationId}:${diff.meeting_id}:${uid}:participants:${addedEventType}`;
            if (sentNotificationKeys.has(dedupeKey)) continue;
            sentNotificationKeys.add(dedupeKey);
            const result = await insertNotification({ userId: uid, category: 'meeting', eventType: addedEventType, audience: 'participants', fallbackTitle: 'دعوت به جلسه', fallbackMessage: `شما به جلسه "${mtgSubject}" دعوت شدید — ${mtgTimeStr}${mtgJalaaliDate ? ` در ${mtgJalaaliDate}` : ''}${agendaSummary}`, placeholders: { ...mtgSmsPlaceholders, full_name: participantNameMap[uid] || '', recipient_greeting: participantNameMap[uid] ? `${participantNameMap[uid]} گرامی` : 'همکار گرامی' }, senderId: userId, senderName: senderName, actionUrl: 'calendar', eventKey: `${operationId}:${diff.meeting_id}:${uid}:participants:${addedEventType}` });
            internalSmsResults.push(result);
          }
        }
        // Removed participants → cancel only
        if (diff.removed_participant_ids.length) {
          const removedEventType = getMeetingTemplateKey('participant', 'cancel');
          for (const uid of diff.removed_participant_ids) {
            const dedupeKey = `${operationId}:${diff.meeting_id}:${uid}:participants:${removedEventType}`;
            if (sentNotificationKeys.has(dedupeKey)) continue;
            sentNotificationKeys.add(dedupeKey);
            const result = await insertNotification({ userId: uid, category: 'meeting', eventType: removedEventType, audience: 'participants', fallbackTitle: 'لغو دعوت', fallbackMessage: `دعوت شما برای جلسه "${mtgSubject}" لغو شد — ${mtgTimeStr}${mtgJalaaliDate ? ` در ${mtgJalaaliDate}` : ''}`, placeholders: { ...mtgSmsPlaceholders, full_name: participantNameMap[uid] || '', recipient_greeting: participantNameMap[uid] ? `${participantNameMap[uid]} گرامی` : 'همکار گرامی' }, senderId: userId, senderName: senderName, actionUrl: 'calendar', eventKey: `${operationId}:${diff.meeting_id}:${uid}:participants:${removedEventType}` });
            internalSmsResults.push(result);
          }
        }
        // Retained participants → change only when important fields changed
        if (!isFirstSchedule && (mtgChangeSet?.importantFields.length ?? 0) > 0 && diff.retained_participant_ids.length) {
          const retainedEventType = getMeetingTemplateKey('participant', 'change');
          for (const uid of diff.retained_participant_ids) {
            const dedupeKey = `${operationId}:${diff.meeting_id}:${uid}:participants:${retainedEventType}`;
            if (sentNotificationKeys.has(dedupeKey)) continue;
            sentNotificationKeys.add(dedupeKey);
            const result = await insertNotification({ userId: uid, category: 'meeting', eventType: retainedEventType, audience: 'participants', fallbackTitle: 'تغییر در جلسه', fallbackMessage: `جلسه "${mtgSubject}" ویرایش شد — ${mtgTimeStr}${mtgJalaaliDate ? ` در ${mtgJalaaliDate}` : ''}${agendaSummary}`, placeholders: { ...mtgSmsPlaceholders, full_name: participantNameMap[uid] || '', recipient_greeting: participantNameMap[uid] ? `${participantNameMap[uid]} گرامی` : 'همکار گرامی' }, senderId: userId, senderName: senderName, actionUrl: 'calendar', eventKey: `${operationId}:${diff.meeting_id}:${uid}:participants:${retainedEventType}` });
            internalSmsResults.push(result);
          }
        }
        // Per-meeting observer diff
        const prevNotifyForMeeting = new Set<string>((snapshot.previousNotifyUserIdsByMeetingId[diff.meeting_id] || []).filter((x: string) => x));
        const addedObserverIds = observerIds.filter(id => !prevNotifyForMeeting.has(id));
        const retainedObserverIds = observerIds.filter(id => prevNotifyForMeeting.has(id));
        const removedObserverIds = [...prevNotifyForMeeting].filter(id => !observerIds.includes(id));

        // Added observers → invite
        if (addedObserverIds.length) {
          const addedObserverEventType = getMeetingTemplateKey('observer', 'invite');
          for (const uid of addedObserverIds) {
            const dedupeKey = `${operationId}:${diff.meeting_id}:${uid}:observers:${addedObserverEventType}`;
            if (sentNotificationKeys.has(dedupeKey)) continue;
            sentNotificationKeys.add(dedupeKey);
            const result = await insertNotification({ userId: uid, category: 'meeting', eventType: addedObserverEventType, audience: 'observers', fallbackTitle: 'اطلاع از جلسه', fallbackMessage: `شما به عنوان مطلع جلسه "${mtgSubject}" ثبت شده‌اید — ${mtgTimeStr}${mtgJalaaliDate ? ` در ${mtgJalaaliDate}` : ''}${agendaSummary}`, placeholders: { ...mtgSmsPlaceholders, full_name: participantNameMap[uid] || '', recipient_greeting: participantNameMap[uid] ? `${participantNameMap[uid]} گرامی` : 'همکار گرامی' }, senderId: userId, senderName: senderName, actionUrl: 'calendar', eventKey: `${operationId}:${diff.meeting_id}:${uid}:observers:${addedObserverEventType}` });
            internalSmsResults.push(result);
          }
        }
        // Removed observers → cancel
        if (removedObserverIds.length) {
          const removedObserverEventType = getMeetingTemplateKey('observer', 'cancel');
          for (const uid of removedObserverIds) {
            const dedupeKey = `${operationId}:${diff.meeting_id}:${uid}:observers:${removedObserverEventType}`;
            if (sentNotificationKeys.has(dedupeKey)) continue;
            sentNotificationKeys.add(dedupeKey);
            const result = await insertNotification({ userId: uid, category: 'meeting', eventType: removedObserverEventType, audience: 'observers', fallbackTitle: 'لغو اطلاع', fallbackMessage: `اطلاع‌رسانی شما برای جلسه "${mtgSubject}" لغو شد — ${mtgTimeStr}${mtgJalaaliDate ? ` در ${mtgJalaaliDate}` : ''}`, placeholders: { ...mtgSmsPlaceholders, full_name: participantNameMap[uid] || '', recipient_greeting: participantNameMap[uid] ? `${participantNameMap[uid]} گرامی` : 'همکار گرامی' }, senderId: userId, senderName: senderName, actionUrl: 'calendar', eventKey: `${operationId}:${diff.meeting_id}:${uid}:observers:${removedObserverEventType}` });
            internalSmsResults.push(result);
          }
        }
        // Retained observers → change only when important fields changed
        if (!isFirstSchedule && (mtgChangeSet?.importantFields.length ?? 0) > 0 && retainedObserverIds.length) {
          const retainedObserverEventType = getMeetingTemplateKey('observer', 'change');
          for (const uid of retainedObserverIds) {
            const dedupeKey = `${operationId}:${diff.meeting_id}:${uid}:observers:${retainedObserverEventType}`;
            if (sentNotificationKeys.has(dedupeKey)) continue;
            sentNotificationKeys.add(dedupeKey);
            const result = await insertNotification({ userId: uid, category: 'meeting', eventType: retainedObserverEventType, audience: 'observers', fallbackTitle: 'تغییر در جلسه', fallbackMessage: `جلسه "${mtgSubject}" ویرایش شد — ${mtgTimeStr}${mtgJalaaliDate ? ` در ${mtgJalaaliDate}` : ''}${agendaSummary}`, placeholders: { ...mtgSmsPlaceholders, full_name: participantNameMap[uid] || '', recipient_greeting: participantNameMap[uid] ? `${participantNameMap[uid]} گرامی` : 'همکار گرامی' }, senderId: userId, senderName: senderName, actionUrl: 'calendar', eventKey: `${operationId}:${diff.meeting_id}:${uid}:observers:${retainedObserverEventType}` });
            internalSmsResults.push(result);
          }
        }

        // External participants diff (per-meeting) — process even when next is empty so removed externals get cancel SMS.
        if (sendSms) {
          const extFallbackSms = `دعوت به جلسه: «${mtgSubject}» | تاریخ: ${mtgJalaaliDate || meetingDateStr} | ساعت: ${mtgTimeStr}${mtgSmsPlaceholders.location_part}`;
          const prevExternalForMeeting = snapshot.prevExternalByMeetingId[diff.meeting_id] || [];
          const extDiff = computeExternalDiff(prevExternalForMeeting, selectedExternal);
          const newExt = extDiff.added;
          const retainedExt = extDiff.retained;
          const removedExt = extDiff.removed;
          // Added externals → invite
          if (newExt.length > 0) {
            const extResult = await sendSmsToExternals(newExt, contacts, extFallbackSms, userId, mtgSmsPlaceholders, 'invite');
            if (extResult) externalSmsResults.push(extResult);
          }
          // Retained externals → change only when important fields changed
          if (!isFirstSchedule && (mtgChangeSet?.importantFields.length ?? 0) > 0 && retainedExt.length > 0) {
            const extChangeFallback = `تغییر جلسه: «${mtgSubject}» | تاریخ: ${mtgJalaaliDate || meetingDateStr} | ساعت: ${mtgTimeStr}${mtgSmsPlaceholders.location_part}`;
            const extChangeResult = await sendSmsToExternals(retainedExt, contacts, extChangeFallback, userId, mtgSmsPlaceholders, 'change');
            if (extChangeResult) externalSmsResults.push(extChangeResult);
          }
          // Removed externals → cancel
          if (removedExt.length > 0) {
            const extCancelFallback = `لغو دعوت: جلسه «${mtgSubject}» در تاریخ ${mtgJalaaliDate || meetingDateStr} لغو شد.`;
            const extCancelResult = await sendSmsToExternals(removedExt, contacts, extCancelFallback, userId, mtgSmsPlaceholders, 'cancel');
            if (extCancelResult) externalSmsResults.push(extCancelResult);
          }
        }
      }
      // Aggregate external SMS results across all meetings in the bulk edit
      let externalSmsResult: ExternalSmsResult | null = null;
      if (externalSmsResults.length > 0) {
        externalSmsResult = externalSmsResults.reduce((acc, r) => ({
          ok: acc.ok && r.ok,
          sent: acc.sent + r.sent,
          skipped: acc.skipped + r.skipped,
          error: acc.error || r.error,
        }));
      }
      // False-success prevention: compute real success/failure from dispatch results.
      const succeeded = internalSmsResults.filter(r => r.status === 'sent' || r.status === 'skipped').length;
      const failed = internalSmsResults.filter(r => r.status === 'failed').length;
      const totalEvents = internalSmsResults.length + externalSmsResults.length;
      if (import.meta.env?.DEV) {
        console.debug('[commitEdit] dispatch summary', {
          totalEvents, succeeded, failed,
          internalSmsResults, externalSmsResults, meetingDiffs,
        });
      }
      const hasAnyDiff = meetingDiffs.some(d =>
        d.added_participant_ids.length > 0 ||
        d.removed_participant_ids.length > 0 ||
        d.retained_participant_ids.length > 0
      );
      if (failed > 0) {
        toast.error(`تغییرات جلسه ذخیره شد، اما اطلاع‌رسانی برای ${failed} نفر ناموفق بود.`);
      } else if (succeeded > 0) {
        toast.success('تغییرات جلسه ذخیره شد و اطلاع‌رسانی انجام شد.');
      } else if (hasAnyDiff) {
        // User chose "with notifications", diff is non-empty, but zero events dispatched — surface as error.
        console.warn('[commitEdit] Notification requested but zero events dispatched despite non-empty diff', { meetingDiffs });
        toast.error('تغییرات جلسه ذخیره شد، اما هیچ اطلاع‌رسانی انجام نشد. لطفاً مجدداً تلاش کنید.');
      }

      showSmsSummary(internalSmsResults, externalSmsResult);

      setEditDecision(null);
      onSuccess(subject, !!prefillMeetingId);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ثبت جلسه');
    } finally {
      setCommitting(false);
      commitLockRef.current = false;
    }
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

        {/* Participants — tags inside input */}
        <MultiSelectField
          label="شرکت‌کنندگان جلسه"
          icon={<Users className="w-4 h-4" />}
          placeholder="جستجوی کاربران..."
          options={[]}
          groups={systemUserGroups}
          selected={participantDisplayItems}
          onAdd={item => setSelectedParticipants(p => p.some(x => x.id === item.id) ? p : [...p, item])}
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
          selected={notifyDisplayItems}
          onAdd={item => setSelectedNotifyUsers(p => p.some(x => x.id === item.id) ? p : [...p, item])}
          onRemove={id => setSelectedNotifyUsers(p => p.filter(x => x.id !== id))}
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
          newExternalEmail={newExternalEmail}
          setNewExternalEmail={setNewExternalEmail}
          newExternalPhone={newExternalPhone}
          setNewExternalPhone={setNewExternalPhone}
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

        <ReminderSection
          reminderMinutes={reminderMinutes}
          setReminderMinutes={setReminderMinutes}
        />

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

        <OnlineMeetingSection
          isOnline={isOnline}
          setIsOnline={setIsOnline}
        />

        <SmsOptionsSection
          sendSms={sendSms}
          setSendSms={setSendSms}
          saveContact={saveContact}
          setSaveContact={setSaveContact}
          repFromContacts={repFromContacts}
          representative={representative}
        />
      </div>

      <FormFooter loading={loading} orgUsersLoading={orgUsersLoading} committing={committing} editDecision={editDecision} onCancel={onCancel} />

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
