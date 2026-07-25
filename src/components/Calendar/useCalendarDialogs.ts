import React, { useState, useCallback, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { insertNotification as insertNotificationFromTemplate } from '../../lib/notifications';
import toast from 'react-hot-toast';
import {
  toJalaali, parseRequestDateToDateStr, jalaaliDatesBetween,
} from './utils';
import type { MeetingData, CalendarEntry, CalendarSubscription, CalendarFormState, PendingSchedule } from './types';

export interface CalendarDialogsState {
  detailMeeting: MeetingData | null;
  setDetailMeeting: React.Dispatch<React.SetStateAction<MeetingData | null>>;
  showMeetingForm: boolean;
  setShowMeetingForm: React.Dispatch<React.SetStateAction<boolean>>;
  prefillData: any;
  setPrefillData: React.Dispatch<React.SetStateAction<any>>;
  activePendingSchedule: PendingSchedule | null;
  setActivePendingSchedule: React.Dispatch<React.SetStateAction<PendingSchedule | null>>;
  repeatEditDialog: { meeting: MeetingData } | null;
  setRepeatEditDialog: React.Dispatch<React.SetStateAction<{ meeting: MeetingData } | null>>;
  deleteMeetingDialog: { id: string; deleteRepeating?: boolean } | null;
  setDeleteMeetingDialog: React.Dispatch<React.SetStateAction<{ id: string; deleteRepeating?: boolean } | null>>;
  showAllDayForm: boolean;
  setShowAllDayForm: React.Dispatch<React.SetStateAction<boolean>>;
  allDayFormDate: { jy: number; jm: number; jd: number } | null;
  setAllDayFormDate: React.Dispatch<React.SetStateAction<{ jy: number; jm: number; jd: number } | null>>;
  allDayFormEndDate: { jy: number; jm: number; jd: number } | null;
  setAllDayFormEndDate: React.Dispatch<React.SetStateAction<{ jy: number; jm: number; jd: number } | null>>;
  allDayFormTitle: string;
  setAllDayFormTitle: React.Dispatch<React.SetStateAction<string>>;
  allDayFormType: 'meeting' | 'leave' | 'other';
  setAllDayFormType: React.Dispatch<React.SetStateAction<'meeting' | 'leave' | 'other'>>;
  showCreateCalendar: boolean;
  setShowCreateCalendar: React.Dispatch<React.SetStateAction<boolean>>;
  editingCalendar: CalendarEntry | null;
  setEditingCalendar: React.Dispatch<React.SetStateAction<CalendarEntry | null>>;
  calendarForm: CalendarFormState;
  setCalendarForm: React.Dispatch<React.SetStateAction<CalendarFormState>>;
  showCalendarList: boolean;
  setShowCalendarList: React.Dispatch<React.SetStateAction<boolean>>;
  calendarListSearch: string;
  setCalendarListSearch: React.Dispatch<React.SetStateAction<string>>;
  showSubscriptionsModal: boolean;
  setShowSubscriptionsModal: React.Dispatch<React.SetStateAction<boolean>>;
  subscriptionsCalendar: CalendarEntry | null;
  setSubscriptionsCalendar: React.Dispatch<React.SetStateAction<CalendarEntry | null>>;
  subscriptions: CalendarSubscription[];
  setSubscriptions: React.Dispatch<React.SetStateAction<CalendarSubscription[]>>;
  subSearch: string;
  setSubSearch: React.Dispatch<React.SetStateAction<string>>;
  subPermission: 'view' | 'edit';
  setSubPermission: React.Dispatch<React.SetStateAction<'view' | 'edit'>>;
  previewMeeting: MeetingData | null;
  setPreviewMeeting: React.Dispatch<React.SetStateAction<MeetingData | null>>;
  previewPos: { x: number; y: number };
  setPreviewPos: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  previewRef: React.RefObject<HTMLDivElement | null>;
  monthDayPopup: { jy: number; jm: number; jd: number; x: number; y: number } | null;
  setMonthDayPopup: React.Dispatch<React.SetStateAction<{ jy: number; jm: number; jd: number; x: number; y: number } | null>>;
  monthDayPopupRef: React.RefObject<HTMLDivElement | null>;
  expandedMeetingId: string | null;
  setExpandedMeetingId: React.Dispatch<React.SetStateAction<string | null>>;
  reminderAlert: { meeting: MeetingData; minutesBefore: number } | null;
  setReminderAlert: React.Dispatch<React.SetStateAction<{ meeting: MeetingData; minutesBefore: number } | null>>;
  handleDeleteMeeting: (id: string, deleteRepeating?: boolean) => void;
  handleDeleteMeetingConfirm: (mode: 'revert' | 'full') => Promise<void>;
  handleSendToGoogleCalendar: (m: MeetingData) => Promise<void>;
  openEditForm: (m: MeetingData & { _editAllIds?: string[] }) => void;
  handleCreateMeetingForDay: (jy: number, jm: number, jd: number) => void;
  handleEditMeeting: (m: MeetingData) => void;
  handleShareFromDetail: (m: MeetingData) => void;
  handleBlockClick: (m: MeetingData, e?: React.MouseEvent) => void;
  resetCalendarForm: () => void;
  handleSaveCalendar: () => Promise<void>;
  handleDeleteCalendar: (id: string) => Promise<void>;
  handleOpenSubscriptions: (cal: CalendarEntry) => Promise<void>;
  handleAddSubscription: (profileUserId: string) => Promise<void>;
  handleRemoveSubscription: (subId: string) => Promise<void>;
  handleUpdateSubPermission: (subId: string, perm: 'view' | 'edit') => Promise<void>;
  fetchSubscriptions: (calendarId: string) => Promise<void>;
}

export function useCalendarDialogs(
  meetings: MeetingData[],
  currentUserId: string | null,
  resolveName: (uid: string) => string,
  fetchMeetings: () => void,
  fetchCalendars: () => void,
  fetchAllDayEvents: () => void,
  insertNotification: (userId: string, title: string, message: string, type?: string, eventType?: string, placeholders?: Record<string, string>) => Promise<void>,
  buildMeetingPlaceholders: (m: MeetingData, recipientId?: string) => Record<string, string>,
  calendars: CalendarEntry[],
  usersById: Record<string, any>,
  pendingSchedule?: PendingSchedule | null,
): CalendarDialogsState {
  const [detailMeeting, setDetailMeeting] = useState<MeetingData | null>(null);
  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [prefillData, setPrefillData] = useState<any>(null);
  const [activePendingSchedule, setActivePendingSchedule] = useState<PendingSchedule | null>(null);
  const [repeatEditDialog, setRepeatEditDialog] = useState<{ meeting: MeetingData } | null>(null);
  const [deleteMeetingDialog, setDeleteMeetingDialog] = useState<{ id: string; deleteRepeating?: boolean } | null>(null);
  const [showAllDayForm, setShowAllDayForm] = useState(false);
  const [allDayFormDate, setAllDayFormDate] = useState<{ jy: number; jm: number; jd: number } | null>(null);
  const [allDayFormEndDate, setAllDayFormEndDate] = useState<{ jy: number; jm: number; jd: number } | null>(null);
  const [allDayFormTitle, setAllDayFormTitle] = useState('');
  const [allDayFormType, setAllDayFormType] = useState<'meeting' | 'leave' | 'other'>('meeting');
  const [showCreateCalendar, setShowCreateCalendar] = useState(false);
  const [editingCalendar, setEditingCalendar] = useState<CalendarEntry | null>(null);
  const [calendarForm, setCalendarForm] = useState<CalendarFormState>({
    name: '', type: 'private', description: '', is_active: true,
    enable_reminder: false, create_online_link: false, show_time_overlap: true, free_for_all: true, color: '#3b82f6',
  });
  const [showCalendarList, setShowCalendarList] = useState(false);
  const [calendarListSearch, setCalendarListSearch] = useState('');
  const [showSubscriptionsModal, setShowSubscriptionsModal] = useState(false);
  const [subscriptionsCalendar, setSubscriptionsCalendar] = useState<CalendarEntry | null>(null);
  const [subscriptions, setSubscriptions] = useState<CalendarSubscription[]>([]);
  const [subSearch, setSubSearch] = useState('');
  const [subPermission, setSubPermission] = useState<'view' | 'edit'>('edit');
  const [previewMeeting, setPreviewMeeting] = useState<MeetingData | null>(null);
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [monthDayPopup, setMonthDayPopup] = useState<{ jy: number; jm: number; jd: number; x: number; y: number } | null>(null);
  const monthDayPopupRef = useRef<HTMLDivElement | null>(null);
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null);
  const [reminderAlert, setReminderAlert] = useState<{ meeting: MeetingData; minutesBefore: number } | null>(null);

  useEffect(() => {
    if (pendingSchedule) {
      setActivePendingSchedule(pendingSchedule);
      const m = pendingSchedule.meeting;
      setPrefillData({
        subject: m.subject, location: m.location, representative: m.representative,
        phone: m.phone, notes: m.notes || '', priority: m.priority,
        meetingId: pendingSchedule.meetingId,
        participantUserIds: m.participant_user_ids || [],
        repeatEnabled: !!(m.repeat_type && m.repeat_type !== 'none'),
        repeatType: (m.repeat_type === 'weekly' || m.repeat_type === 'monthly') ? m.repeat_type : 'weekly',
        repeatInterval: m.repeat_interval || 1,
        repeatEndDate: m.repeat_end_date || '',
        repeatWeekday: m.repeat_weekday ?? 0,
      });
    }
  }, [pendingSchedule]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (previewRef.current && !previewRef.current.contains(e.target as Node)) setPreviewMeeting(null);
    };
    if (previewMeeting) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [previewMeeting]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (monthDayPopupRef.current && !monthDayPopupRef.current.contains(e.target as Node)) setMonthDayPopup(null);
    };
    if (monthDayPopup) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [monthDayPopup]);

  const handleDeleteMeeting = async (id: string, deleteRepeating = false) => {
    setDeleteMeetingDialog({ id, deleteRepeating });
  };

  const handleDeleteMeetingConfirm = async (mode: 'revert' | 'full') => {
    if (!deleteMeetingDialog) return;
    const { id, deleteRepeating } = deleteMeetingDialog;
    setDeleteMeetingDialog(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('لطفا وارد شوید'); return; }
      const meeting = meetings.find(x => x.id === id);
      if (!meeting) return;
      const isOwner = meeting.user_id === user.id;

      const sendCancelNotifications = async (m: MeetingData) => {
        try {
          const pIds = (m.participant_user_ids || []) as string[];
          const notifyIds = [...pIds, ...((m.notify_users || []) as string[])].filter(uid => uid !== user.id);
          if (!notifyIds.length) return;
          await Promise.all(notifyIds.map(uid =>
            insertNotificationFromTemplate({
              userId: uid,
              category: 'meeting',
              eventType: 'cancel',
              audience: pIds.includes(uid) ? 'participants' : 'observers',
              fallbackTitle: 'جلسه لغو شد',
              fallbackMessage: `جلسه «${m.subject}» لغو شده است`,
              placeholders: buildMeetingPlaceholders(m, uid),
              senderId: user.id,
              actionUrl: 'calendar',
            })
          ));
        } catch {}
      };

      if (isOwner) {
        if (mode === 'revert') {
          const { data: fullMtg } = await supabase
            .from('meetings')
            .select('subject, location, representative, phone, notes, priority, participant_user_ids, notify_users, external_participants, meeting_manager')
            .eq('id', id)
            .maybeSingle();
          if (!fullMtg) throw new Error('جلسه یافت نشد');

          const { data: oldParticipants } = await supabase.from('participants').select('name').eq('meeting_id', id);
          const { data: oldActions } = await supabase.from('actions').select('title, status, assignee').eq('meeting_id', id);
          const { data: oldAgendaItems } = await supabase.from('meeting_agenda_items').select('title, presenter, duration_minutes, sort_order').eq('meeting_id', id).order('sort_order');

          const { data: newMtg, error: insertErr } = await supabase
            .from('meetings')
            .insert([{
              subject: fullMtg.subject,
              location: fullMtg.location ?? null,
              representative: fullMtg.representative ?? null,
              phone: fullMtg.phone ?? null,
              notes: fullMtg.notes ?? null,
              priority: fullMtg.priority,
              participant_user_ids: fullMtg.participant_user_ids ?? [],
              notify_users: fullMtg.notify_users ?? [],
              external_participants: fullMtg.external_participants ?? [],
              meeting_manager: fullMtg.meeting_manager ?? null,
              user_id: user.id,
              status: 'open',
              status_type: 'approved',
              request_date: null,
              start_time: null,
              end_time: null,
              duration: null,
              repeat_type: null,
              repeat_interval: null,
              repeat_end_date: null,
              repeat_weekday: null,
            }])
            .select('id')
            .single();
          if (insertErr) throw insertErr;

          const newId = newMtg.id;
          if ((oldParticipants ?? []).length > 0) {
            await supabase.from('participants').insert((oldParticipants!).map(p => ({ meeting_id: newId, name: p.name })));
          }
          if ((oldActions ?? []).length > 0) {
            await supabase.from('actions').insert((oldActions!).map(a => ({ meeting_id: newId, title: a.title, status: a.status, assignee: a.assignee })));
          }
          if ((oldAgendaItems ?? []).length > 0) {
            await supabase.from('meeting_agenda_items').insert((oldAgendaItems!).map(a => ({ meeting_id: newId, title: a.title, presenter: a.presenter, duration_minutes: a.duration_minutes, sort_order: a.sort_order })));
          }

          await sendCancelNotifications({ ...meeting, ...fullMtg } as MeetingData);

          await supabase.from('meeting_inbox').delete().eq('meeting_id', id);
          const { error: delErr } = await supabase.from('meetings').delete().eq('id', id);
          if (delErr) throw delErr;

          toast.success('جلسه حذف شد و درخواست جدید ایجاد گردید');
          setDetailMeeting(null);
          fetchMeetings();
          return;
        }

        if (deleteRepeating) {
          const { data: repeatingMeetings } = await supabase
            .from('meetings')
            .select('id,subject,participant_user_ids,notify_users,request_date,start_time,end_time')
            .eq('user_id', user.id)
            .eq('subject', meeting.subject)
            .neq('repeat_type', 'none');
          if (repeatingMeetings?.length) {
            await Promise.all(repeatingMeetings.map(m => sendCancelNotifications(m as MeetingData)));
          }
          const { error } = await supabase.from('meetings').delete().eq('user_id', user.id).eq('subject', meeting.subject).neq('repeat_type', 'none');
          if (error) throw error;
        } else {
          await sendCancelNotifications(meeting);
          await supabase.from('meeting_inbox').delete().eq('meeting_id', id);
          const { error } = await supabase.from('meetings').delete().eq('id', id).eq('user_id', user.id);
          if (error) throw error;
        }

        toast.success('جلسه حذف شد');
      } else {
        const { error } = await supabase.rpc('remove_self_from_meeting', { p_meeting_id: id });
        if (error) throw error;
        toast.success('جلسه از تقویم شما حذف شد');
      }
      setDetailMeeting(null);
      fetchMeetings();
    } catch (err: any) { toast.error(err?.message || 'خطا در حذف جلسه'); }
  };

  const handleSendToGoogleCalendar = async (m: MeetingData) => {
    const title = encodeURIComponent(m.subject);
    const loc = encodeURIComponent(m.location || '');
    const dateStr = parseRequestDateToDateStr(m.request_date);
    if (!dateStr || !m.start_time || !m.end_time) { toast.error('زمان جلسه تنظیم نشده'); return; }
    const start = dateStr.replace(/-/g, '') + 'T' + m.start_time.replace(':', '') + '00';
    const end = dateStr.replace(/-/g, '') + 'T' + m.end_time.replace(':', '') + '00';

    const participantNames = (m.participant_user_ids || [])
      .map(uid => resolveName(uid))
      .join('، ');
    const notifyNames = ((m.notify_users || []) as string[])
      .map(uid => resolveName(uid))
      .join('، ');
    const externalNames = (m.external_participants || []).join('، ');

    const { data: agendaRows } = await supabase
      .from('meeting_agenda_items')
      .select('title, presenter, duration_minutes, sort_order')
      .eq('meeting_id', m.id)
      .order('sort_order', { ascending: true });
    const agendaText = (agendaRows && agendaRows.length > 0)
      ? 'دستور جلسه:\n' + agendaRows.map((item: any, idx: number) => {
          const parts = [`${idx + 1}. ${item.title}`];
          if (item.presenter) parts.push(`ارائه‌دهنده: ${item.presenter}`);
          if (item.duration_minutes) parts.push(`${item.duration_minutes} دقیقه`);
          return parts.join(' | ');
        }).join('\n')
      : '';

    const detailLines = [
      m.representative ? `نماینده: ${m.representative}` : '',
      m.phone ? `تلفن تماس: ${m.phone}` : '',
      participantNames ? `شرکت‌کنندگان: ${participantNames}` : '',
      notifyNames ? `مطلعین: ${notifyNames}` : '',
      externalNames ? `خارج سازمان: ${externalNames}` : '',
      m.is_online && m.conference_room_id ? `جلسه آنلاین: ${window.location.origin}/?conference=${m.conference_room_id}` : '',
      m.notes ? `یادداشت: ${m.notes}` : '',
      m.priority ? `اولویت: ${{ high: 'بالا', medium: 'متوسط', low: 'پایین' }[m.priority] || m.priority}` : '',
      agendaText,
    ].filter(Boolean).join('\n');

    const details = encodeURIComponent(detailLines);
    window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${loc}`, '_blank');
  };

  const openEditForm = (m: MeetingData & { _editAllIds?: string[] }) => {
    const date = parseRequestDateToDateStr(m.request_date);
    let dateJy, dateJm, dateJd;
    if (date) { const d = new Date(date + 'T00:00:00'); const j = toJalaali(d); dateJy = j.jy; dateJm = j.jm; dateJd = j.jd; }
    const hasRepeat = !!(m.repeat_type && m.repeat_type !== 'none');
    setPrefillData({
      subject: m.subject, location: m.location, representative: m.representative, phone: m.phone,
      notes: m.notes || '', priority: m.priority, meetingId: m.id,
      startTime: m.start_time || '', endTime: m.end_time || '',
      dateJy, dateJm, dateJd,
      calendarId: m.calendar_id, membersOnly: m.members_only || false,
      repeatEnabled: hasRepeat,
      repeatType: (m.repeat_type === 'weekly' || m.repeat_type === 'monthly') ? m.repeat_type : 'weekly',
      repeatInterval: m.repeat_interval || 1,
      repeatEndDate: m.repeat_end_date || '',
      repeatWeekday: m.repeat_weekday ?? 0,
      editAllIds: m._editAllIds,
    });
    setDetailMeeting(null);
    setPreviewMeeting(null);
    setShowMeetingForm(true);
  };

  const handleCreateMeetingForDay = useCallback((jy: number, jm: number, jd: number) => {
    setPrefillData({ dateJy: jy, dateJm: jm, dateJd: jd });
    setShowMeetingForm(true);
  }, []);

  const handleEditMeeting = (m: MeetingData) => {
    const hasRepeat = !!(m.repeat_type && m.repeat_type !== 'none');
    if (hasRepeat) { setRepeatEditDialog({ meeting: m }); setDetailMeeting(null); setPreviewMeeting(null); }
    else openEditForm(m);
  };

  const handleShareFromDetail = (m: MeetingData) => {
    setDetailMeeting(null);
    const cal = calendars.find(c => c.id === m.calendar_id) || calendars[0];
    if (cal) handleOpenSubscriptions(cal);
  };

  const handleBlockClick = (m: MeetingData, e?: React.MouseEvent) => {
    const dragMovedRef = (window as any).__calendarDragMovedRef;
    if (dragMovedRef?.current) { dragMovedRef.current = false; return; }
    if (previewMeeting?.id === m.id) { setPreviewMeeting(null); return; }
    if (e) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setPreviewPos({ x: rect.left, y: rect.top });
    }
    setPreviewMeeting(m);
  };

  const resetCalendarForm = () => {
    setCalendarForm({ name: '', type: 'shared', description: '', is_active: true, enable_reminder: false, create_online_link: false, show_time_overlap: true, free_for_all: true, color: '#3b82f6' });
  };

  const handleSaveCalendar = async () => {
    if (!calendarForm.name.trim()) { toast.error('نام تقویم الزامی است'); return; }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const record = {
        name: calendarForm.name, type: calendarForm.type, description: calendarForm.description,
        is_active: calendarForm.is_active, enable_reminder: calendarForm.enable_reminder,
        enable_overlap: calendarForm.show_time_overlap, color: calendarForm.color,
      };
      if (editingCalendar) {
        await supabase.from('calendars').update(record).eq('id', editingCalendar.id);
        toast.success('تقویم ویرایش شد');
        insertNotification(user.id, 'تقویم ویرایش شد', `تقویم "${calendarForm.name}" ویرایش شد`, 'calendar');
      } else {
        await supabase.from('calendars').insert([{ ...record, user_id: user.id }]);
        toast.success('تقویم ایجاد شد');
        insertNotification(user.id, 'تقویم جدید ایجاد شد', `تقویم "${calendarForm.name}" ایجاد شد`, 'calendar');
      }
      setShowCreateCalendar(false); setEditingCalendar(null); resetCalendarForm();
      fetchCalendars();
    } catch { toast.error('خطا در ذخیره تقویم'); }
  };

  const handleDeleteCalendar = async (id: string) => {
    if (!confirm('آیا از حذف این تقویم اطمینان دارید؟')) return;
    try {
      const cal = calendars.find(c => c.id === id);
      await supabase.from('calendars').delete().eq('id', id);
      toast.success('تقویم حذف شد');
      if (cal && currentUserId) insertNotification(currentUserId, 'تقویم حذف شد', `تقویم "${cal.name}" حذف شد`, 'calendar');
      fetchCalendars(); setShowCalendarList(false);
    } catch { toast.error('خطا در حذف تقویم'); }
  };

  const fetchSubscriptions = async (calendarId: string) => {
    try {
      const { data: subs } = await supabase.from('calendar_subscriptions').select('id, calendar_id, user_id, permission').eq('calendar_id', calendarId);
      if (!subs || subs.length === 0) { setSubscriptions([]); return; }
      setSubscriptions(subs.map((s: any) => ({ ...s, profile: usersById[s.user_id] ? { full_name: usersById[s.user_id].full_name || '', email: '' } : null })));
    } catch {}
  };

  const handleOpenSubscriptions = async (cal: CalendarEntry) => {
    setSubscriptionsCalendar(cal);
    await fetchSubscriptions(cal.id);
    setSubSearch('');
    setShowSubscriptionsModal(true);
  };

  const handleAddSubscription = async (profileUserId: string) => {
    if (!subscriptionsCalendar) return;
    if (subscriptions.some(s => s.user_id === profileUserId)) { toast.error('این کاربر قبلاً اضافه شده'); return; }
    try {
      await supabase.from('calendar_subscriptions').insert([{ calendar_id: subscriptionsCalendar.id, user_id: profileUserId, permission: subPermission }]);
      toast.success('کاربر اضافه شد');
      insertNotification(profileUserId, 'اشتراک تقویم', `شما به تقویم "${subscriptionsCalendar.name}" دسترسی پیدا کردید`, 'calendar');
      if (currentUserId) insertNotification(currentUserId, 'کاربر اضافه شد', `کاربر به تقویم "${subscriptionsCalendar.name}" اضافه شد`, 'calendar');
      fetchSubscriptions(subscriptionsCalendar.id);
    } catch { toast.error('خطا در اضافه کردن کاربر'); }
  };

  const handleRemoveSubscription = async (subId: string) => {
    try {
      const sub = subscriptions.find(s => s.id === subId);
      await supabase.from('calendar_subscriptions').delete().eq('id', subId);
      toast.success('کاربر حذف شد');
      if (sub && subscriptionsCalendar) {
        insertNotification(sub.user_id, 'حذف از تقویم', `دسترسی شما به تقویم "${subscriptionsCalendar.name}" لغو شد`, 'calendar');
        if (currentUserId) insertNotification(currentUserId, 'کاربر حذف شد', `کاربر از تقویم "${subscriptionsCalendar.name}" حذف شد`, 'calendar');
      }
      if (subscriptionsCalendar) fetchSubscriptions(subscriptionsCalendar.id);
    } catch { toast.error('خطا در حذف کاربر'); }
  };

  const handleUpdateSubPermission = async (subId: string, perm: 'view' | 'edit') => {
    try {
      await supabase.from('calendar_subscriptions').update({ permission: perm }).eq('id', subId);
      if (subscriptionsCalendar) fetchSubscriptions(subscriptionsCalendar.id);
    } catch {}
  };

  return {
    detailMeeting, setDetailMeeting,
    showMeetingForm, setShowMeetingForm,
    prefillData, setPrefillData,
    activePendingSchedule, setActivePendingSchedule,
    repeatEditDialog, setRepeatEditDialog,
    deleteMeetingDialog, setDeleteMeetingDialog,
    showAllDayForm, setShowAllDayForm,
    allDayFormDate, setAllDayFormDate,
    allDayFormEndDate, setAllDayFormEndDate,
    allDayFormTitle, setAllDayFormTitle,
    allDayFormType, setAllDayFormType,
    showCreateCalendar, setShowCreateCalendar,
    editingCalendar, setEditingCalendar,
    calendarForm, setCalendarForm,
    showCalendarList, setShowCalendarList,
    calendarListSearch, setCalendarListSearch,
    showSubscriptionsModal, setShowSubscriptionsModal,
    subscriptionsCalendar, setSubscriptionsCalendar,
    subscriptions, setSubscriptions,
    subSearch, setSubSearch,
    subPermission, setSubPermission,
    previewMeeting, setPreviewMeeting,
    previewPos, setPreviewPos,
    previewRef,
    monthDayPopup, setMonthDayPopup,
    monthDayPopupRef,
    expandedMeetingId, setExpandedMeetingId,
    reminderAlert, setReminderAlert,
    handleDeleteMeeting,
    handleDeleteMeetingConfirm,
    handleSendToGoogleCalendar,
    openEditForm,
    handleCreateMeetingForDay,
    handleEditMeeting,
    handleShareFromDetail,
    handleBlockClick,
    resetCalendarForm,
    handleSaveCalendar,
    handleDeleteCalendar,
    handleOpenSubscriptions,
    handleAddSubscription,
    handleRemoveSubscription,
    handleUpdateSubPermission,
    fetchSubscriptions,
  };
}
