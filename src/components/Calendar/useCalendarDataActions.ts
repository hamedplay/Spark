// @ts-nocheck
import React, { useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { insertNotification as insertNotificationFromTemplate } from '../../lib/notifications';
import toast from 'react-hot-toast';
import { MeetingData, CalendarEntry } from './types';
import { toJalaali, jalaaliToDate, getJalaaliMonthDays, parseRequestDateToDateStr } from './utils';

export function useCalendarDataActions(scope: Record<string, any>) {
  const {
    allDayDragEnd, allDayDragStart, allDayEvents, buildMeetingPlaceholders, calendarForm, calendars,
    currentJm, currentJy, currentUserId, deleteMeetingDialog, dragMovedRef, editingCalendar,
    insertNotification, isRefreshing, meetings, monthDayPopup, monthDayPopupRef, previewMeeting,
    previewRef, providedUserId, resolveName, setAllDayEvents, setCalendarForm, setCalendars,
    setCurrentUserId, setDeleteMeetingDialog, setDetailMeeting, setEditingCalendar, setEnabledCalendarIds, setIsRefreshing,
    setMeetings, setMonthDayPopup, setPrefillData, setPreviewMeeting, setPreviewPos, setRepeatEditDialog,
    setShowCalendarList, setShowCreateCalendar, setShowMeetingForm, setShowSubscriptionsModal, setSubSearch, setSubscribedCalendars,
    setSubscriptions, setSubscriptionsCalendar, subPermission, subscriptions, subscriptionsCalendar, usersById
  } = scope;

  // ---- Fetch ----
  // Ref so real-time callback always calls the latest version (avoids stale closure)
  const fetchMeetingsRef = useRef<() => void>(() => {});

  const fetchCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    console.log('[CalendarPage] fetchCurrentUser → userId:', user?.id ?? 'null');
    if (user) setCurrentUserId(user.id);
  };

  const fetchMeetings = useCallback(async (jy?: number, jm?: number) => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const userId = currentUserId ?? providedUserId;
      if (!userId) { console.log('[CalendarPage] fetchMeetings: no user, returning'); return; }

      // Build ±2-month Gregorian date range around the viewed month
      const baseJy = jy ?? currentJy;
      const baseJm = jm ?? currentJm;
      if (!baseJy || !baseJm) { console.log('[CalendarPage] fetchMeetings: no jy/jm, returning (jy=' + baseJy + ' jm=' + baseJm + ')'); return; }

      const rangeStart = jalaaliToDate(baseJy, Math.max(1, baseJm - 2), 1);
      const endJm = baseJm + 2;
      const endJy = endJm > 12 ? baseJy + 1 : baseJy;
      const normalEndJm = endJm > 12 ? endJm - 12 : endJm;
      const daysInEndMonth = getJalaaliMonthDays(endJy, normalEndJm);
      const rangeEnd = jalaaliToDate(endJy, normalEndJm, daysInEndMonth);

      // request_date is stored as Tehran midnight expressed in UTC (UTC = Tehran date - 1 day + 20:30).
      // Example: Tehran June 22 midnight = 2026-06-21T20:30:00Z.
      // To capture all Tehran-day meetings we subtract 1 day from range start and add 1 day to range end,
      // then use plain YYYY-MM-DD string comparison (which sorts correctly for ISO strings).
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayBefore = new Date(rangeStart.getTime() - 86400000);
      const dayAfter  = new Date(rangeEnd.getTime()  + 86400000);
      const queryFrom = fmt(dayBefore);
      const queryTo   = fmt(dayAfter);
      console.log('[CalendarPage] fetchMeetings query range:', queryFrom, '→', queryTo, '(jy/jm:', baseJy, baseJm + ')');

      const [{ data, error }, { data: inboxRows }, { data: ownerDelegateRows, error: ownerDelegateError }] = await Promise.all([
        supabase.from('meetings')
          .select('id,subject,request_date,start_time,end_time,duration,location,representative,phone,notes,priority,status,status_type,created_at,user_id,calendar_id,external_participants,participant_user_ids,repeat_type,repeat_interval,repeat_end_date,repeat_weekday,reminder_minutes,notify_users,members_only,meeting_manager,is_online,conference_room_id')
          .neq('status', 'closed')
          .gte('request_date', queryFrom)
          .lte('request_date', queryTo)
          .order('start_time', { ascending: true }),
        supabase.from('meeting_inbox')
          .select('meeting_id, status')
          .eq('user_id', userId),
        supabase.rpc('get_my_meeting_delegations_v1'),
      ]);

      if (error) throw error;
      if (ownerDelegateError) {
        console.warn('[CalendarPage] meeting delegation status enrichment unavailable:', ownerDelegateError);
      }

      const inboxStatus = new Map<string, string>(
        (inboxRows || []).map((r: any) => [r.meeting_id, r.status])
      );

      // Visibility rules (mirrors the required calendar query):
      //   Creator      → always visible (they own the meeting)
      //   Participant  → visible unless inbox is explicitly 'pending' or 'declined'
      //                  (accepted ✓, no-entry = directly added/delegated ✓, delegated ✓)
      //   Observer /
      //   Subscribed   → visible unless explicitly pending or declined
      const filtered = (data || []).filter((m: any) => {
        if (m.user_id === userId) return true; // creator

        const isParticipant = (m.participant_user_ids || []).includes(userId);
        if (isParticipant) {
          const s = inboxStatus.get(m.id);
          return s !== 'pending' && s !== 'declined';
        }

        const s = inboxStatus.get(m.id);
        return s !== 'pending' && s !== 'declined';
      });
      const ownerDelegateByMeeting = new Map<string, any>(
        (!ownerDelegateError && ownerDelegateRows ? ownerDelegateRows : []).map((row: any) => [row.meeting_id, row])
      );
      const enriched = filtered.map((meeting: any) => {
        if (meeting.user_id !== userId) return meeting;
        const delegation = ownerDelegateByMeeting.get(meeting.id);
        if (!delegation) return meeting;
        return {
          ...meeting,
          owner_delegate_user_id: delegation.delegate_user_id,
          owner_delegate_name: delegation.delegate_name,
          owner_delegate_status: delegation.status,
          owner_delegate_updated_at: delegation.updated_at,
        };
      });

      console.log('[CalendarPage] fetchMeetings → setMeetings count:', enriched.length, 'userId:', userId, 'jy/jm:', baseJy, baseJm);
      // Sample the first 5 meetings to debug date grouping
      enriched.slice(0, 5).forEach((m: any) => {
        const groupKey = parseRequestDateToDateStr(m.request_date);
        const rawDate = new Date(m.request_date);
        const jalKey = groupKey ? (() => { const jk = toJalaali(new Date(groupKey + 'T00:00:00')); return `${jk.jy}/${jk.jm}/${jk.jd}`; })() : 'null';
        console.log('[CalendarPage] sample meeting:', m.subject, '| request_date raw:', m.request_date, '| parsedGreg:', groupKey, '| jalali:', jalKey, '| rawDateUTC:', rawDate.toISOString(), '| start_time:', m.start_time);
      });
      setMeetings(enriched);
    } catch { toast.error('خطا در دریافت جلسات'); }
    finally { setIsRefreshing(false); }
  }, [currentJy, currentJm, isRefreshing, currentUserId, providedUserId]);

  // Keep ref in sync so real-time callbacks always call latest version
  useEffect(() => { fetchMeetingsRef.current = () => fetchMeetings(); }, [fetchMeetings]);

  useEffect(() => {
    const userId = currentUserId ?? providedUserId;
    if (!userId) return;
    const channel = supabase
      .channel(`calendar-owner-delegate-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_inbox' }, () => {
        fetchMeetingsRef.current();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUserId, providedUserId]);

  // Re-fetch when visible month changes
  useEffect(() => {
    if (currentJy && currentJm) fetchMeetings(currentJy, currentJm);
  }, [currentJy, currentJm]);

  const fetchAllDayEvents = useCallback(async () => {
    const { data } = await supabase.from('all_day_events').select('*');
    if (data) setAllDayEvents(data as any);
  }, []);

  useEffect(() => { fetchAllDayEvents(); }, [fetchAllDayEvents]);

  const getAllDayEventsForDay = useCallback((jy: number, jm: number, jd: number) =>
    allDayEvents.filter(e => e.date_jy === jy && e.date_jm === jm && e.date_jd === jd),
  [allDayEvents]);

  // Returns all gregorian dates between two jalaali dates inclusive
  const jalaaliDatesBetween = (start: { jy: number; jm: number; jd: number }, end: { jy: number; jm: number; jd: number }) => {
    const startG = jalaaliToDate(start.jy, start.jm, start.jd);
    const endG = jalaaliToDate(end.jy, end.jm, end.jd);
    const [from, to] = startG <= endG ? [startG, endG] : [endG, startG];
    const dates: { jy: number; jm: number; jd: number }[] = [];
    const cur = new Date(from);
    while (cur <= to) {
      const j = toJalaali(cur);
      dates.push(j);
      cur.setDate(cur.getDate() + 1);
    }
    return dates;
  };

  // Check if a jalaali date is in the drag-select range
  const isInAllDayDragRange = (jy: number, jm: number, jd: number) => {
    if (!allDayDragStart || !allDayDragEnd) return false;
    const startG = jalaaliToDate(allDayDragStart.jy, allDayDragStart.jm, allDayDragStart.jd);
    const endG = jalaaliToDate(allDayDragEnd.jy, allDayDragEnd.jm, allDayDragEnd.jd);
    const [from, to] = startG <= endG ? [startG, endG] : [endG, startG];
    const cur = jalaaliToDate(jy, jm, jd);
    return cur >= from && cur <= to;
  };

  const toFarsiTime = (t: string) => {
    if (!t) return '';
    const farsiDigits = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
    return t.replace(/\d/g, d => farsiDigits[parseInt(d)]);
  };

  const fetchCalendars = async () => {
    try {
      const userId = currentUserId ?? providedUserId;
      if (!userId) return;
      const { data: own } = await supabase.from('calendars').select('*').eq('user_id', userId).order('created_at', { ascending: false });
      const ownCals = (own || []) as CalendarEntry[];
      setCalendars(ownCals);
      const { data: subs } = await supabase.from('calendar_subscriptions').select('calendar_id, calendars(*)').eq('user_id', userId);
      const subCals = subs ? (subs.map((s: any) => s.calendars).filter(Boolean) as CalendarEntry[]) : [];
      setSubscribedCalendars(subCals);
      const newEnabledIds = new Set([...ownCals.map(c => c.id), ...subCals.map(c => c.id)]);
      console.log('[CalendarPage] fetchCalendars → enabledCalendarIds:', [...newEnabledIds], 'ownCals:', ownCals.length, 'subCals:', subCals.length);
      setEnabledCalendarIds(newEnabledIds);
    } catch {}
  };

  const fetchSubscriptions = async (calendarId: string) => {
    try {
      const { data: subs } = await supabase.from('calendar_subscriptions').select('id, calendar_id, user_id, permission').eq('calendar_id', calendarId);
      if (!subs || subs.length === 0) { setSubscriptions([]); return; }
      setSubscriptions(subs.map((s: any) => ({ ...s, profile: usersById[s.user_id] ? { full_name: usersById[s.user_id].full_name || '', email: '' } : null })));
    } catch {}
  };

  // ---- Calendar CRUD ----
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

  // ---- Meeting handlers ----
  const handleDeleteMeeting = async (id: string, deleteRepeating = false) => {
    // Show custom confirmation modal instead of window.confirm
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

      const normalizeExternalName = (value: string) => value.trim().replace(/\s+/g, ' ');

      const sendExternalCancel = async (m: MeetingData) => {
        let externalNames = (m.external_participants || []) as string[];
        if (!externalNames.length && m.id) {
          const { data: freshMeeting, error: freshMeetingError } = await supabase
            .from('meetings')
            .select('external_participants')
            .eq('id', m.id)
            .maybeSingle();
          if (freshMeetingError) throw freshMeetingError;
          externalNames = (freshMeeting?.external_participants || []) as string[];
        }
        if (!externalNames.length) return;

        const { data: contacts, error: contactsError } = await supabase
          .from('contacts_email')
          .select('name, phone')
          .eq('user_id', user.id);
        if (contactsError) throw contactsError;

        const wantedNames = new Set(externalNames.map(normalizeExternalName));
        const mobiles = Array.from(new Set(
          (contacts || [])
            .filter((contact: any) => wantedNames.has(normalizeExternalName(contact.name || '')))
            .map((contact: any) => String(contact.phone || '').trim())
            .filter(Boolean)
        ));
        if (!mobiles.length) return;

        const { data: smsResult, error: smsError } = await supabase.functions.invoke('send-sms', {
          body: {
            mode: 'external',
            mobiles,
            meetingId: m.id,
            category: 'meeting',
            eventType: 'cancel',
            triggeredByUserId: user.id,
          },
        });
        if (smsError) throw smsError;
        if (smsResult?.ok === false) throw new Error(smsResult?.error || 'ارسال لغو جلسه برای مهمانان خارج سازمان ناموفق بود');
      };

      // Helper: send cancel notification to all participants/observers and external guests.
      const sendCancelNotifications = async (m: MeetingData) => {
        try {
          const pIds = (m.participant_user_ids || []) as string[];
          const notifyIds = [...pIds, ...((m.notify_users || []) as string[])].filter(uid => uid !== user.id);
          if (notifyIds.length) {
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
          }
        } catch {}

        await sendExternalCancel(m);
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

          // Notify participants that the scheduled meeting was cancelled (new unscheduled request created)
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
          // Notify participants of each repeating meeting before bulk delete
          const { data: repeatingMeetings } = await supabase
            .from('meetings')
            .select('id,subject,participant_user_ids,notify_users,external_participants,request_date,start_time,end_time')
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
    if (dragMovedRef.current) { dragMovedRef.current = false; return; }
    if (previewMeeting?.id === m.id) { setPreviewMeeting(null); return; }
    if (e) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setPreviewPos({ x: rect.left, y: rect.top });
    }
    setPreviewMeeting(m);
  };

  // Close preview when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (previewRef.current && !previewRef.current.contains(e.target as Node)) setPreviewMeeting(null);
    };
    if (previewMeeting) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [previewMeeting]);

  // Close month day popup when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (monthDayPopupRef.current && !monthDayPopupRef.current.contains(e.target as Node)) setMonthDayPopup(null);
    };
    if (monthDayPopup) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [monthDayPopup]);

  return {
    fetchAllDayEvents, fetchCalendars, fetchCurrentUser, fetchMeetings, fetchMeetingsRef, getAllDayEventsForDay,
    handleAddSubscription, handleBlockClick, handleCreateMeetingForDay, handleDeleteCalendar, handleDeleteMeeting, handleDeleteMeetingConfirm,
    handleEditMeeting, handleOpenSubscriptions, handleRemoveSubscription, handleSaveCalendar, handleSendToGoogleCalendar, handleShareFromDetail,
    handleUpdateSubPermission, isInAllDayDragRange, jalaaliDatesBetween, openEditForm, resetCalendarForm, toFarsiTime
  };
}
