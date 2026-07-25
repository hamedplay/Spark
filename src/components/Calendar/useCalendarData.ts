import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { insertNotification as insertNotificationFromTemplate } from '../../lib/notifications';
import toast from 'react-hot-toast';
import {
  toJalaali, jalaaliToDate, getJalaaliMonthDays, parseRequestDateToDateStr,
  timeToMinutes,
} from './utils';
import type { MeetingData, CalendarEntry, CalendarSubscription, PendingSchedule } from './types';

type ViewMode = 'month' | 'week' | 'day' | 'list-week' | 'list-month';

export interface CalendarDataState {
  meetings: MeetingData[];
  setMeetings: React.Dispatch<React.SetStateAction<MeetingData[]>>;
  isRefreshing: boolean;
  currentUserId: string | null;
  setCurrentUserId: React.Dispatch<React.SetStateAction<string | null>>;
  calendars: CalendarEntry[];
  setCalendars: React.Dispatch<React.SetStateAction<CalendarEntry[]>>;
  subscribedCalendars: CalendarEntry[];
  setSubscribedCalendars: React.Dispatch<React.SetStateAction<CalendarEntry[]>>;
  enabledCalendarIds: Set<string>;
  setEnabledCalendarIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  occasions: {
    id: string; title: string; calendar_type: string;
    month: number; day: number; is_holiday: boolean; is_celebration: boolean;
  }[];
  occasionsEnabled: boolean;
  setOccasionsEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  allDayEvents: { id: string; title: string; type: string; date_jy: number; date_jm: number; date_jd: number; user_id: string }[];
  setAllDayEvents: React.Dispatch<React.SetStateAction<{ id: string; title: string; type: string; date_jy: number; date_jm: number; date_jd: number; user_id: string }[]>>;
  currentJy: number;
  setCurrentJy: React.Dispatch<React.SetStateAction<number>>;
  currentJm: number;
  setCurrentJm: React.Dispatch<React.SetStateAction<number>>;
  fetchMeetings: (jy?: number, jm?: number) => Promise<void>;
  fetchCalendars: () => Promise<void>;
  fetchAllDayEvents: () => Promise<void>;
  getAllDayEventsForDay: (jy: number, jm: number, jd: number) => { id: string; title: string; type: string; date_jy: number; date_jm: number; date_jd: number; user_id: string }[];
  handleToggleOccasions: () => Promise<void>;
  insertNotification: (userId: string, title: string, message: string, type?: string, eventType?: string, placeholders?: Record<string, string>) => Promise<void>;
  buildMeetingPlaceholders: (m: MeetingData, recipientId?: string) => Record<string, string>;
  resolveName: (uid: string) => string;
}

export function useCalendarData(
  currentJy: number,
  currentJm: number,
  resolveName: (uid: string) => string,
  fetchMeetingsRef: React.MutableRefObject<() => void>,
  fetchCalendarsRef: React.MutableRefObject<() => Promise<void>>,
  fetchAllDayEventsRef: React.MutableRefObject<() => Promise<void>>,
): CalendarDataState {
  const [meetings, setMeetings] = useState<MeetingData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [calendars, setCalendars] = useState<CalendarEntry[]>([]);
  const [subscribedCalendars, setSubscribedCalendars] = useState<CalendarEntry[]>([]);
  const [enabledCalendarIds, setEnabledCalendarIds] = useState<Set<string>>(new Set());
  const [occasions, setOccasions] = useState<{
    id: string; title: string; calendar_type: string;
    month: number; day: number; is_holiday: boolean; is_celebration: boolean;
  }[]>([]);
  const [occasionsEnabled, setOccasionsEnabled] = useState(true);
  const [allDayEvents, setAllDayEvents] = useState<{ id: string; title: string; type: string; date_jy: number; date_jm: number; date_jd: number; user_id: string }[]>([]);

  const insertNotification = useCallback(async (userId: string, title: string, message: string, type = 'meeting', eventType = 'invite', placeholders?: Record<string, string>) => {
    try {
      await insertNotificationFromTemplate({
        userId, category: type, eventType,
        fallbackTitle: title, fallbackMessage: message,
        placeholders: placeholders || { meeting_subject: message },
        senderId: currentUserId || null, actionUrl: type,
      });
    } catch {}
  }, [currentUserId]);

  const buildMeetingPlaceholders = useCallback((m: MeetingData, recipientId?: string): Record<string, string> => {
    const gregDateStr = parseRequestDateToDateStr(m.request_date);
    let meetingDateStr = '';
    if (gregDateStr) {
      const d = new Date(gregDateStr + 'T00:00:00');
      const j = toJalaali(d);
      meetingDateStr = `${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
    }
    const meetingTimeStr = m.start_time && m.end_time ? `${m.start_time} - ${m.end_time}` : m.start_time || '';
    const senderName = currentUserId ? resolveName(currentUserId) : '';
    const recipientName = recipientId ? resolveName(recipientId) : '';
    return {
      meeting_subject: m.subject || '',
      meeting_date: meetingDateStr,
      meeting_time: meetingTimeStr,
      location: m.location || '',
      location_part: m.location ? ` | ${m.location}` : '',
      sender_name: senderName,
      full_name: recipientName,
      representative: m.representative || '',
    };
  }, [resolveName, currentUserId]);

  const fetchCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    console.log('[CalendarPage] fetchCurrentUser → userId:', user?.id ?? 'null');
    if (user) setCurrentUserId(user.id);
  };

  const fetchMeetings = useCallback(async (jy?: number, jm?: number) => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { console.log('[CalendarPage] fetchMeetings: no user, returning'); return; }

      const baseJy = jy ?? currentJy;
      const baseJm = jm ?? currentJm;
      if (!baseJy || !baseJm) { console.log('[CalendarPage] fetchMeetings: no jy/jm, returning (jy=' + baseJy + ' jm=' + baseJm + ')'); return; }

      const rangeStart = jalaaliToDate(baseJy, Math.max(1, baseJm - 2), 1);
      const endJm = baseJm + 2;
      const endJy = endJm > 12 ? baseJy + 1 : baseJy;
      const normalEndJm = endJm > 12 ? endJm - 12 : endJm;
      const daysInEndMonth = getJalaaliMonthDays(endJy, normalEndJm);
      const rangeEnd = jalaaliToDate(endJy, normalEndJm, daysInEndMonth);

      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayBefore = new Date(rangeStart.getTime() - 86400000);
      const dayAfter  = new Date(rangeEnd.getTime()  + 86400000);
      const queryFrom = fmt(dayBefore);
      const queryTo   = fmt(dayAfter);
      console.log('[CalendarPage] fetchMeetings query range:', queryFrom, '→', queryTo, '(jy/jm:', baseJy, baseJm + ')');

      const [{ data, error }, { data: inboxRows }] = await Promise.all([
        supabase.from('meetings')
          .select('id,subject,request_date,start_time,end_time,duration,location,representative,phone,notes,priority,status,status_type,created_at,user_id,calendar_id,external_participants,participant_user_ids,repeat_type,repeat_interval,repeat_end_date,repeat_weekday,reminder_minutes,notify_users,members_only,meeting_manager,is_online,conference_room_id')
          .neq('status', 'closed')
          .gte('request_date', queryFrom)
          .lte('request_date', queryTo)
          .order('start_time', { ascending: true }),
        supabase.from('meeting_inbox')
          .select('meeting_id, status')
          .eq('user_id', user.id),
      ]);

      if (error) throw error;

      const inboxStatus = new Map<string, string>(
        (inboxRows || []).map((r: any) => [r.meeting_id, r.status])
      );

      const filtered = (data || []).filter((m: any) => {
        if (m.user_id === user.id) return true;

        const isParticipant = (m.participant_user_ids || []).includes(user.id);
        if (isParticipant) {
          const s = inboxStatus.get(m.id);
          return s !== 'pending' && s !== 'declined';
        }

        const s = inboxStatus.get(m.id);
        return s !== 'pending' && s !== 'declined';
      });
      console.log('[CalendarPage] fetchMeetings → setMeetings count:', filtered.length, 'userId:', user.id, 'jy/jm:', baseJy, baseJm);
      filtered.slice(0, 5).forEach((m: any) => {
        const groupKey = parseRequestDateToDateStr(m.request_date);
        const rawDate = new Date(m.request_date);
        const jalKey = groupKey ? (() => { const jk = toJalaali(new Date(groupKey + 'T00:00:00')); return `${jk.jy}/${jk.jm}/${jk.jd}`; })() : 'null';
        console.log('[CalendarPage] sample meeting:', m.subject, '| request_date raw:', m.request_date, '| parsedGreg:', groupKey, '| jalali:', jalKey, '| rawDateUTC:', rawDate.toISOString(), '| start_time:', m.start_time);
      });
      setMeetings(filtered);
    } catch { toast.error('خطا در دریافت جلسات'); }
    finally { setIsRefreshing(false); }
  }, [currentJy, currentJm, isRefreshing]);

  useEffect(() => { fetchMeetingsRef.current = () => fetchMeetings(); }, [fetchMeetings]);

  useEffect(() => {
    if (currentJy && currentJm) fetchMeetings(currentJy, currentJm);
  }, [currentJy, currentJm]);

  const fetchAllDayEvents = useCallback(async () => {
    const { data } = await supabase.from('all_day_events').select('*');
    if (data) setAllDayEvents(data as any);
  }, []);

  useEffect(() => { fetchAllDayEventsRef.current = () => fetchAllDayEvents(); }, [fetchAllDayEvents]);

  useEffect(() => { fetchAllDayEvents(); }, [fetchAllDayEvents]);

  const getAllDayEventsForDay = useCallback((jy: number, jm: number, jd: number) =>
    allDayEvents.filter(e => e.date_jy === jy && e.date_jm === jm && e.date_jd === jd),
  [allDayEvents]);

  const fetchCalendars = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: own } = await supabase.from('calendars').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
      const ownCals = (own || []) as CalendarEntry[];
      setCalendars(ownCals);
      const { data: subs } = await supabase.from('calendar_subscriptions').select('calendar_id, calendars(*)').eq('user_id', user.id);
      const subCals = subs ? (subs.map((s: any) => s.calendars).filter(Boolean) as CalendarEntry[]) : [];
      setSubscribedCalendars(subCals);
      const newEnabledIds = new Set([...ownCals.map(c => c.id), ...subCals.map(c => c.id)]);
      console.log('[CalendarPage] fetchCalendars → enabledCalendarIds:', [...newEnabledIds], 'ownCals:', ownCals.length, 'subCals:', subCals.length);
      setEnabledCalendarIds(newEnabledIds);
    } catch {}
  }, []);

  useEffect(() => { fetchCalendarsRef.current = () => fetchCalendars(); }, [fetchCalendars]);

  useEffect(() => {
    supabase.from('calendar_occasions').select('id,title,calendar_type,month,day,is_holiday,is_celebration')
      .eq('is_active', true).then(({ data }) => { if (data) setOccasions(data as any); });
  }, []);

  useEffect(() => {
    if (!currentUserId) return;
    supabase.from('calendars').select('id,is_active').eq('user_id', currentUserId).eq('is_occasions', true).maybeSingle()
      .then(({ data }) => { if (data) setOccasionsEnabled(data.is_active); });
  }, [currentUserId]);

  const handleToggleOccasions = useCallback(async () => {
    const next = !occasionsEnabled;
    setOccasionsEnabled(next);
    if (!currentUserId) return;
    await supabase.from('calendars').update({ is_active: next }).eq('user_id', currentUserId).eq('is_occasions', true);
  }, [occasionsEnabled, currentUserId]);

  useEffect(() => {
    console.log('[CalendarPage] MOUNT');
    fetchCurrentUser();
    fetchCalendars();

    const channel = supabase
      .channel(`calendar-realtime-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => { console.log('[CalendarPage] realtime: meetings change'); fetchMeetingsRef.current(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_inbox' }, () => fetchMeetingsRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendars' }, () => { console.log('[CalendarPage] realtime: calendars change'); fetchCalendarsRef.current(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_subscriptions' }, () => fetchCalendarsRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'all_day_events' }, () => fetchAllDayEventsRef.current())
      .subscribe();

    return () => {
      console.log('[CalendarPage] UNMOUNT');
      supabase.removeChannel(channel);
    };
  }, []);

  return {
    meetings, setMeetings,
    isRefreshing,
    currentUserId, setCurrentUserId,
    calendars, setCalendars,
    subscribedCalendars, setSubscribedCalendars,
    enabledCalendarIds, setEnabledCalendarIds,
    occasions,
    occasionsEnabled, setOccasionsEnabled,
    allDayEvents, setAllDayEvents,
    currentJy, setCurrentJy,
    currentJm, setCurrentJm,
    fetchMeetings,
    fetchCalendars,
    fetchAllDayEvents,
    getAllDayEventsForDay,
    handleToggleOccasions,
    insertNotification,
    buildMeetingPlaceholders,
    resolveName,
  };
}
