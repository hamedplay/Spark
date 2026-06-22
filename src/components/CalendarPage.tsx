import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePermissions } from '../context/PermissionsContext';
import { ChevronLeft, ChevronRight, Calendar, Clock, MapPin, RefreshCw, ChevronDown, X, Plus, Users, Search, PanelRight, Trash2, RotateCcw } from 'lucide-react';
import { CalendarViews } from './Calendar/CalendarViews';
import { supabase } from '../lib/supabase';
import { insertNotification as insertNotificationFromTemplate } from '../lib/notifications';
import toast from 'react-hot-toast';
import { CalendarMeetingForm } from './CalendarMeetingForm';
import { MeetingInboxButton } from './MeetingInboxButton';
import { useUserPreferences } from '../context/UserPreferencesContext';

import { MeetingData, CalendarEntry, CalendarSubscription, ProfileEntry, PendingSchedule } from './Calendar/types';
import {
  JALAALI_MONTHS, JALAALI_WEEKDAYS, JALAALI_WEEKDAYS_SHORT,
  PRIORITY_COLORS, SLOT_HEIGHT, HOURS_START, HOURS_END, DEFAULT_CALENDAR_COLOR, VIEW_OPTIONS,
  toJalaali, jalaaliToDate, getJalaaliMonthDays, getJalaaliFirstDayOfWeek,
  jsDayToWeekday, jalaaliToYYYYMMDD, parseRequestDateToDateStr,
  timeToMinutes, minutesToTime, minutesToSlotIndex,
} from './Calendar/utils';
import { CalendarSidebar } from './Calendar/CalendarSidebar';
import { MeetingDetailModal } from './Calendar/MeetingDetailModal';
import { CreateEditCalendarModal } from './Calendar/CreateEditCalendarModal';
import { SubscriptionsModal } from './Calendar/SubscriptionsModal';
import { CalendarListModal } from './Calendar/CalendarListModal';

type ViewMode = 'month' | 'week' | 'day' | 'list-week' | 'list-month';

interface CalendarFormState {
  name: string;
  type: 'private' | 'public' | 'shared';
  description: string;
  is_active: boolean;
  enable_reminder: boolean;
  create_online_link: boolean;
  show_time_overlap: boolean;
  free_for_all: boolean;
  color: string;
}

interface CalendarPageProps {
  pendingSchedule?: PendingSchedule | null;
  onScheduleComplete?: () => void;
  pendingMentionParticipants?: string[];
  pendingMentionNotes?: string;
  onPendingMentionConsumed?: () => void;
  initialView?: ViewMode;
  onViewConsumed?: () => void;
  sparkNavigateDate?: { jy: number; jm: number; jd: number; view?: string } | null;
  onSparkNavigateDateConsumed?: () => void;
  sparkCalendarMeetingPrefill?: any;
  onSparkCalendarMeetingPrefillConsumed?: () => void;
}

export function CalendarPage({
  pendingSchedule, onScheduleComplete,
  pendingMentionParticipants, pendingMentionNotes, onPendingMentionConsumed,
  initialView, onViewConsumed,
  sparkNavigateDate, onSparkNavigateDateConsumed,
  sparkCalendarMeetingPrefill, onSparkCalendarMeetingPrefillConsumed,
}: CalendarPageProps) {
  const { prefs } = useUserPreferences();
  const [meetings, setMeetings] = useState<MeetingData[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    // Mobile (< 768px): default to day view; desktop: use user preference
    if (window.innerWidth < 768) return 'day';
    const p = localStorage.getItem('user_prefs_calendar_view') as ViewMode | null;
    return p ?? 'week';
  });
  const [showViewDropdown, setShowViewDropdown] = useState(false);
  const [currentJy, setCurrentJy] = useState(0);
  const [currentJm, setCurrentJm] = useState(0);
  const [selectedJd, setSelectedJd] = useState(0);
  const [selectedJy, setSelectedJy] = useState(0);
  const [selectedJm, setSelectedJm] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [sidebarJy, setSidebarJy] = useState(0);
  const [sidebarJm, setSidebarJm] = useState(0);

  const [calendars, setCalendars] = useState<CalendarEntry[]>([]);
  const [subscribedCalendars, setSubscribedCalendars] = useState<CalendarEntry[]>([]);
  const [enabledCalendarIds, setEnabledCalendarIds] = useState<Set<string>>(new Set());

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
  const [allProfiles, setAllProfiles] = useState<ProfileEntry[]>([]);
  const [subSearch, setSubSearch] = useState('');
  const [subPermission, setSubPermission] = useState<'view' | 'edit'>('edit');

  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [myGroupOpen, setMyGroupOpen] = useState(true);
  const [sharedGroupOpen, setSharedGroupOpen] = useState(true);
  const [publicGroupOpen, setPublicGroupOpen] = useState(true);

  const [detailMeeting, setDetailMeeting] = useState<MeetingData | null>(null);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New-meeting drag
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartSlot, setDragStartSlot] = useState<number | null>(null);
  const [dragEndSlot, setDragEndSlot] = useState<number | null>(null);
  const [dragDate, setDragDate] = useState<{ jy: number; jm: number; jd: number } | null>(null);
  const timeGridRef = useRef<HTMLDivElement | null>(null);
  const timeScrollRef = useRef<HTMLDivElement | null>(null);

  const [showMeetingForm, setShowMeetingForm] = useState(false);
  const [prefillData, setPrefillData] = useState<any>(null);
  const [activePendingSchedule, setActivePendingSchedule] = useState<PendingSchedule | null>(null);

  // Move meeting drag
  const [dragMoveMeeting, setDragMoveMeeting] = useState<MeetingData | null>(null);
  const [dragMoveStartY, setDragMoveStartY] = useState(0);
  const [dragMoveStartX, setDragMoveStartX] = useState(0);
  const dragMovedRef = useRef(false);
  const [dragMoveOriginalSlot, setDragMoveOriginalSlot] = useState(0);
  const [dragMoveOriginalEndSlot, setDragMoveOriginalEndSlot] = useState(0);
  const [dragMoveCurrentDeltaSlot, setDragMoveCurrentDeltaSlot] = useState(0);
  const [dragMoveCurrentDeltaDay, setDragMoveCurrentDeltaDay] = useState(0);
  const [dragMoveOriginalDate, setDragMoveOriginalDate] = useState('');
  const weekGridRef = useRef<HTMLDivElement | null>(null);
  const dayGridRef = useRef<HTMLDivElement | null>(null);

  // Resize meeting
  const [resizeMeeting, setResizeMeeting] = useState<MeetingData | null>(null);
  const [resizeStartY, setResizeStartY] = useState(0);
  const [resizeOriginalEndSlot, setResizeOriginalEndSlot] = useState(0);
  const [resizeCurrentDelta, setResizeCurrentDelta] = useState(0);

  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [showDesktopSidebar, setShowDesktopSidebar] = useState(true);

  // Search
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return meetings.filter(m =>
      m.subject?.toLowerCase().includes(q) ||
      m.location?.toLowerCase().includes(q) ||
      m.representative?.toLowerCase().includes(q)
    );
  }, [meetings, searchQuery]);

  const visibleMeetings = useMemo(() => {
    // Use Tehran-adjusted today so comparison is consistent with parseRequestDateToDateStr
    const IST_OFFSET_MS = 210 * 60 * 1000;
    const tehranNow = new Date(Date.now() + IST_OFFSET_MS);
    const todayStr = `${tehranNow.getUTCFullYear()}-${String(tehranNow.getUTCMonth()+1).padStart(2,'0')}-${String(tehranNow.getUTCDate()).padStart(2,'0')}`;
    const result = meetings.filter(m => {
      const dateStr = parseRequestDateToDateStr(m.request_date);
      if (dateStr && dateStr < todayStr && !prefs.show_past_meetings) return false;
      // Only treat archived meetings as "cancelled" when they are NOT scheduled calendar
      // appointments. status='archived' + status_type='scheduled' means a real meeting.
      if (m.status === 'archived' && m.status_type !== 'scheduled' && !prefs.show_cancelled_meetings) return false;
      return true;
    });
    console.log('[CalendarPage] visibleMeetings: total=' + meetings.length + ' visible=' + result.length + ' show_past=' + prefs.show_past_meetings + ' show_cancelled=' + prefs.show_cancelled_meetings + ' todayStr(Tehran)=' + todayStr);
    return result;
  }, [meetings, prefs.show_past_meetings, prefs.show_cancelled_meetings]);

  const navigateToMeeting = (m: MeetingData) => {
    const dateStr = parseRequestDateToDateStr(m.request_date);
    if (!dateStr) return;
    const [y, mo, d] = dateStr.split('-').map(Number);
    const j = toJalaali(new Date(y, mo - 1, d));
    setCurrentJy(j.jy); setCurrentJm(j.jm);
    setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd);
    setSidebarJy(j.jy); setSidebarJm(j.jm);
    if (m.start_time) setViewMode('day'); else setViewMode('month');
    setShowSearch(false);
    setSearchQuery('');
    setTimeout(() => setDetailMeeting(m), 100);
  };

  useEffect(() => {
    if (showSearch && searchInputRef.current) searchInputRef.current.focus();
  }, [showSearch]);

  // Apply user's default calendar view preference (desktop only, once)
  const prefViewApplied = useRef(false);
  useEffect(() => {
    if (prefViewApplied.current || window.innerWidth < 768) return;
    if (!prefs.default_calendar_view) return;
    prefViewApplied.current = true;
    const map: Record<string, ViewMode> = { month: 'month', week: 'week', day: 'day', list: 'list-month' };
    const mapped = map[prefs.default_calendar_view];
    if (mapped) {
      setViewMode(mapped);
      localStorage.setItem('user_prefs_calendar_view', mapped);
    }
  }, [prefs.default_calendar_view]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
        setSearchQuery('');
      }
    };
    if (showSearch) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSearch]);

  // Hover/click preview popup for day/week blocks
  const [previewMeeting, setPreviewMeeting] = useState<MeetingData | null>(null);
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Month day popup
  const [monthDayPopup, setMonthDayPopup] = useState<{ jy: number; jm: number; jd: number; x: number; y: number } | null>(null);
  const monthDayPopupRef = useRef<HTMLDivElement | null>(null);

  // All-day event creation
  const [showAllDayForm, setShowAllDayForm] = useState(false);
  const [allDayFormDate, setAllDayFormDate] = useState<{ jy: number; jm: number; jd: number } | null>(null);
  const [allDayFormEndDate, setAllDayFormEndDate] = useState<{ jy: number; jm: number; jd: number } | null>(null);
  const [allDayFormTitle, setAllDayFormTitle] = useState('');
  const [allDayFormType, setAllDayFormType] = useState<'meeting' | 'leave' | 'other'>('meeting');
  const [allDayEvents, setAllDayEvents] = useState<{ id: string; title: string; type: string; date_jy: number; date_jm: number; date_jd: number; user_id: string }[]>([]);

  // All-day drag select state
  const [allDayDragStart, setAllDayDragStart] = useState<{ jy: number; jm: number; jd: number } | null>(null);
  const [allDayDragEnd, setAllDayDragEnd] = useState<{ jy: number; jm: number; jd: number } | null>(null);
  const [allDayDragging, setAllDayDragging] = useState(false);

  // Repeat edit scope dialog
  const [repeatEditDialog, setRepeatEditDialog] = useState<{ meeting: MeetingData } | null>(null);

  // Delete meeting confirmation modal
  const [deleteMeetingDialog, setDeleteMeetingDialog] = useState<{ id: string; deleteRepeating?: boolean } | null>(null);

  // ── Calendar occasions ────────────────────────────────────────────────────
  const [occasions, setOccasions] = useState<{
    id: string; title: string; calendar_type: string;
    month: number; day: number; is_holiday: boolean; is_celebration: boolean;
  }[]>([]);
  const [occasionsEnabled, setOccasionsEnabled] = useState(true);

  useEffect(() => {
    supabase.from('calendar_occasions').select('id,title,calendar_type,month,day,is_holiday,is_celebration')
      .eq('is_active', true).then(({ data }) => { if (data) setOccasions(data as any); });
  }, []);

  // Load occasions enabled state from user's occasions calendar is_active field
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

  const totalSlots = (HOURS_END - HOURS_START) * 2;

  // Adjustable slot height (px per 30-min slot) — wheel/pinch on hour column
  const [slotHeight, setSlotHeight] = useState(SLOT_HEIGHT);
  const adjustSlotHeight = (delta: number) => {
    setSlotHeight(prev => Math.min(120, Math.max(20, prev + delta)));
  };

  // Pinch-to-zoom state
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartHeightRef = useRef<number>(SLOT_HEIGHT);

  const handleHourColTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.sqrt(dx * dx + dy * dy);
      pinchStartHeightRef.current = slotHeight;
      // Don't call preventDefault here — let the parent scroll container handle scroll
    }
  };
  const handleHourColTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scale = dist / pinchStartDistRef.current;
      const newH = Math.min(120, Math.max(20, Math.round(pinchStartHeightRef.current * scale)));
      setSlotHeight(newH);
    }
  };
  const handleHourColTouchEnd = () => { pinchStartDistRef.current = null; };

  // Work-hour boundaries from system_config (default 07:00–19:30)
  const [workStartMin, setWorkStartMin] = useState(420);  // 07:00
  const [workEndMin, setWorkEndMin] = useState(1170);     // 19:30

  // Hide off-hours based on permission
  const { hasPermission } = usePermissions();
  const [hideOffHours, setHideOffHours] = useState(false);
  const canHideOffHours = hasPermission('calendar_hide_offhours');

  // When hiding off-hours, clip visible range to work hours (with 1hr buffer)
  const visibleStartMin = hideOffHours ? Math.max(HOURS_START * 60, workStartMin - 60) : HOURS_START * 60;
  const visibleEndMin = hideOffHours ? Math.min(HOURS_END * 60, workEndMin + 60) : HOURS_END * 60;
  const visibleStartHour = Math.floor(visibleStartMin / 60);
  const visibleEndHour = Math.ceil(visibleEndMin / 60);

  useEffect(() => {
    supabase.from('system_config').select('key,value').eq('section', 'regional')
      .in('key', ['work_start_time', 'work_end_time', 'hide_offhours_default']).then(({ data }) => {
      if (!data) return;
      data.forEach(row => {
        if (row.key === 'work_start_time' && row.value) {
          const m = timeToMinutes(row.value);
          if (m >= 0) setWorkStartMin(m);
        }
        if (row.key === 'work_end_time' && row.value) {
          const m = timeToMinutes(row.value);
          if (m >= 0) setWorkEndMin(m);
        }
        if (row.key === 'hide_offhours_default') {
          setHideOffHours(row.value === 'true');
        }
      });
    });
  }, []);

  // Spark: change view mode
  useEffect(() => {
    if (!initialView) return;
    setViewMode(initialView);
    onViewConsumed?.();
  }, [initialView]);

  // Spark: navigate to a specific date
  useEffect(() => {
    if (!sparkNavigateDate) return;
    const { jy, jm, jd, view } = sparkNavigateDate;
    setCurrentJy(jy);
    setCurrentJm(jm);
    setSelectedJy(jy);
    setSelectedJm(jm);
    setSelectedJd(jd);
    setSidebarJy(jy);
    setSidebarJm(jm);
    if (view) setViewMode(view as ViewMode);
    onSparkNavigateDateConsumed?.();
  }, [sparkNavigateDate]);

  // Spark: open calendar meeting form with prefill
  useEffect(() => {
    if (!sparkCalendarMeetingPrefill) return;
    setPrefillData(sparkCalendarMeetingPrefill);
    setShowMeetingForm(true);
    onSparkCalendarMeetingPrefillConsumed?.();
  }, [sparkCalendarMeetingPrefill]);

  // Track which meetings we've already fired reminders for in this session
  const firedRemindersRef = useRef<Set<string>>(new Set());
  const [reminderAlert, setReminderAlert] = useState<{ meeting: MeetingData; minutesBefore: number } | null>(null);

  const sendNotification = useCallback((title: string, body: string, icon?: string) => {
    if (!('Notification' in window)) return;
    const doSend = () => new Notification(title, { body, icon: icon || '/icons/icon-192x192.png', dir: 'rtl', lang: 'fa' });
    if (Notification.permission === 'granted') doSend();
    else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if (p === 'granted') doSend(); });
  }, []);

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Reminder checker — runs every 30 seconds
  useEffect(() => {
    const checkReminders = () => {
      if (!currentUserId || !meetings.length) return;
      const now = new Date();
      const IST_OFFSET_MS = 210 * 60 * 1000;
      const tehranNow = new Date(now.getTime() + IST_OFFSET_MS);
      const todayStr = `${tehranNow.getUTCFullYear()}-${String(tehranNow.getUTCMonth()+1).padStart(2,'0')}-${String(tehranNow.getUTCDate()).padStart(2,'0')}`;
      meetings.forEach(m => {
        if (!m.reminder_minutes || m.reminder_minutes === 0) return;
        if (!m.start_time) return;
        const isParticipant = m.user_id === currentUserId ||
          (m.participant_user_ids || []).includes(currentUserId) ||
          ((m.notify_users || []) as string[]).includes(currentUserId);
        if (!isParticipant) return;

        const dateStr = parseRequestDateToDateStr(m.request_date);
        if (dateStr !== todayStr) return;

        const [hh, mm] = m.start_time.split(':').map(Number);
        const meetingMs = new Date(todayStr + 'T00:00:00').getTime() + (hh * 60 + mm) * 60000;
        const reminderMs = meetingMs - m.reminder_minutes * 60000;
        const nowMs = now.getTime();
        const key = `${m.id}-${m.reminder_minutes}`;

        // Fire if we're within a 30-second window of reminder time and haven't fired yet
        if (nowMs >= reminderMs && nowMs < reminderMs + 30000 && !firedRemindersRef.current.has(key)) {
          firedRemindersRef.current.add(key);
          const label = m.reminder_minutes >= 60
            ? `${m.reminder_minutes / 60} ساعت`
            : `${m.reminder_minutes} دقیقه`;
          const body = `جلسه "${m.subject}" ${label} دیگر شروع می‌شود — ${m.start_time}`;
          sendNotification('یادآوری جلسه', body);
          setReminderAlert({ meeting: m, minutesBefore: m.reminder_minutes });
        }
      });
    };
    const iv = setInterval(() => { setCurrentTime(new Date()); checkReminders(); }, 30000);
    checkReminders();
    return () => clearInterval(iv);
  }, [meetings, currentUserId, sendNotification]);

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

  const notifyUsers = useCallback(async (userIds: string[], title: string, message: string, type = 'meeting', eventType = 'invite', placeholders?: Record<string, string>) => {
    if (!userIds.length) return;
    try {
      await Promise.all(userIds.map(uid => insertNotificationFromTemplate({
        userId: uid, category: type, eventType,
        fallbackTitle: title, fallbackMessage: message,
        placeholders: placeholders || { meeting_subject: message },
        senderId: currentUserId || null, actionUrl: type,
      })));
    } catch {}
  }, [currentUserId]);

  const buildMeetingPlaceholders = useCallback((m: MeetingData, recipientId?: string): Record<string, string> => {
    const gregDateStr = parseRequestDateToDateStr(m.request_date);
    let meetingDateStr = '';
    if (gregDateStr) {
      const d = new Date(gregDateStr + 'T00:00:00');
      const j = toJalaali(d);
      meetingDateStr = `${j.jd}/${j.jm}/${j.jy}`;
    }
    const meetingTimeStr = m.start_time && m.end_time ? `${m.start_time} - ${m.end_time}` : m.start_time || '';
    const senderName = allProfiles.find(p => p.user_id === currentUserId)?.full_name || '';
    const recipientName = recipientId ? (allProfiles.find(p => p.user_id === recipientId)?.full_name || '') : '';
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
  }, [allProfiles, currentUserId]);

  // ---- Init ----
  useEffect(() => {
    console.log('[CalendarPage] MOUNT');
    const now = toJalaali(new Date());
    setCurrentJy(now.jy); setCurrentJm(now.jm);
    setSelectedJy(now.jy); setSelectedJm(now.jm); setSelectedJd(now.jd);
    setSidebarJy(now.jy); setSidebarJm(now.jm);
    fetchCurrentUser();
    fetchCalendars();
    fetchAllProfiles();

    const channel = supabase
      .channel(`calendar-realtime-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => { console.log('[CalendarPage] realtime: meetings change'); fetchMeetingsRef.current(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_inbox' }, () => fetchMeetingsRef.current())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendars' }, () => { console.log('[CalendarPage] realtime: calendars change'); fetchCalendars(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_subscriptions' }, () => fetchCalendars())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'all_day_events' }, () => fetchAllDayEvents())
      .subscribe();

    return () => {
      console.log('[CalendarPage] UNMOUNT');
      supabase.removeChannel(channel);
    };
  }, []);

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

  // Store pending mention data — will be injected when user drags a time slot
  const pendingMentionRef = React.useRef<{ participantUserIds?: string[]; notes?: string } | null>(null);
  useEffect(() => {
    if ((pendingMentionParticipants && pendingMentionParticipants.length > 0) || pendingMentionNotes) {
      pendingMentionRef.current = {
        ...(pendingMentionParticipants && pendingMentionParticipants.length > 0 ? { participantUserIds: pendingMentionParticipants } : {}),
        ...(pendingMentionNotes ? { notes: pendingMentionNotes } : {}),
      };
      // Show toast to guide user
      import('react-hot-toast').then(({ default: toast }) => {
        toast('زمان جلسه را در تقویم انتخاب (درگ) کنید', { duration: 5000, icon: '📅' });
      });
    } else {
      pendingMentionRef.current = null;
    }
  }, [pendingMentionParticipants, pendingMentionNotes]);

  // Scroll to current time on view change
  useEffect(() => {
    if (viewMode === 'day' || viewMode === 'week') {
      const timer = setTimeout(() => {
        if (!timeScrollRef.current) return;
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const targetMinutes = Math.max(nowMinutes, 6 * 60);
        const targetSlot = targetMinutes / 30;
        const scrollTop = targetSlot * slotHeight - timeScrollRef.current.clientHeight / 2;
        timeScrollRef.current.scrollTop = Math.max(0, scrollTop);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [viewMode]);

  // When hideOffHours changes, scroll to work start
  useEffect(() => {
    if (!timeScrollRef.current || (viewMode !== 'day' && viewMode !== 'week')) return;
    const timer = setTimeout(() => {
      if (!timeScrollRef.current) return;
      const scrollTop = hideOffHours
        ? ((workStartMin - HOURS_START * 60) / 30) * slotHeight - 20
        : ((Math.max(new Date().getHours() * 60 + new Date().getMinutes(), 6 * 60)) / 30) * slotHeight - (timeScrollRef.current.clientHeight / 2);
      timeScrollRef.current.scrollTop = Math.max(0, scrollTop);
    }, 50);
    return () => clearTimeout(timer);
  }, [hideOffHours]);

  // ---- Fetch ----
  // Ref so real-time callback always calls the latest version (avoids stale closure)
  const fetchMeetingsRef = useRef<() => void>(() => {});

  const fetchCurrentUser = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    console.log('[CalendarPage] fetchCurrentUser → userId:', user?.id ?? 'null');
    if (user) setCurrentUserId(user.id);
  };

  const fetchMeetings = useCallback(async (jy?: number, jm?: number) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { console.log('[CalendarPage] fetchMeetings: no user, returning'); return; }

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

      // Visibility rules (mirrors the required calendar query):
      //   Creator      → always visible (they own the meeting)
      //   Participant  → visible unless inbox is explicitly 'pending' or 'declined'
      //                  (accepted ✓, no-entry = directly added/delegated ✓, delegated ✓)
      //   Observer /
      //   Subscribed   → visible unless explicitly pending or declined
      const filtered = (data || []).filter((m: any) => {
        if (m.user_id === user.id) return true; // creator

        const isParticipant = (m.participant_user_ids || []).includes(user.id);
        if (isParticipant) {
          const s = inboxStatus.get(m.id);
          return s !== 'pending' && s !== 'declined';
        }

        const s = inboxStatus.get(m.id);
        return s !== 'pending' && s !== 'declined';
      });
      console.log('[CalendarPage] fetchMeetings → setMeetings count:', filtered.length, 'userId:', user.id, 'jy/jm:', baseJy, baseJm);
      // Sample the first 5 meetings to debug date grouping
      filtered.slice(0, 5).forEach((m: any) => {
        const groupKey = parseRequestDateToDateStr(m.request_date);
        const rawDate = new Date(m.request_date);
        const jalKey = groupKey ? (() => { const jk = toJalaali(new Date(groupKey + 'T00:00:00')); return `${jk.jy}/${jk.jm}/${jk.jd}`; })() : 'null';
        console.log('[CalendarPage] sample meeting:', m.subject, '| request_date raw:', m.request_date, '| parsedGreg:', groupKey, '| jalali:', jalKey, '| rawDateUTC:', rawDate.toISOString(), '| start_time:', m.start_time);
      });
      setMeetings(filtered);
    } catch { toast.error('خطا در دریافت جلسات'); }
  }, [currentJy, currentJm]);

  // Keep ref in sync so real-time callbacks always call latest version
  useEffect(() => { fetchMeetingsRef.current = () => fetchMeetings(); }, [fetchMeetings]);

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
  };

  const fetchAllProfiles = async () => {
    try {
      const { data } = await supabase.from('profiles').select('user_id, full_name, email');
      setAllProfiles(data || []);
    } catch {}
  };

  const fetchSubscriptions = async (calendarId: string) => {
    try {
      const { data: subs } = await supabase.from('calendar_subscriptions').select('id, calendar_id, user_id, permission').eq('calendar_id', calendarId);
      if (!subs || subs.length === 0) { setSubscriptions([]); return; }
      const userIds = subs.map((s: any) => s.user_id);
      const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds);
      const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.user_id, p]));
      setSubscriptions(subs.map((s: any) => ({ ...s, profile: profileMap[s.user_id] || null })));
    } catch {}
  };

  // ---- Calendar CRUD ----
  const resetCalendarForm = () => {
    setCalendarForm({ name: '', type: 'private', description: '', is_active: true, enable_reminder: false, create_online_link: false, show_time_overlap: true, free_for_all: true, color: '#3b82f6' });
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
    await Promise.all([fetchSubscriptions(cal.id), fetchAllProfiles()]);
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

      // Helper: send cancel notification to all participants/observers of a given meeting object
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

  const handleSendToGoogleCalendar = (m: MeetingData) => {
    const title = encodeURIComponent(m.subject);
    const loc = encodeURIComponent(m.location || '');
    const dateStr = parseRequestDateToDateStr(m.request_date);
    if (!dateStr || !m.start_time || !m.end_time) { toast.error('زمان جلسه تنظیم نشده'); return; }
    const start = dateStr.replace(/-/g, '') + 'T' + m.start_time.replace(':', '') + '00';
    const end = dateStr.replace(/-/g, '') + 'T' + m.end_time.replace(':', '') + '00';

    // Build comprehensive details string
    const participantNames = (m.participant_user_ids || [])
      .map(uid => allProfiles.find(p => p.user_id === uid)?.full_name || uid.slice(0, 8))
      .join('، ');
    const notifyNames = ((m.notify_users || []) as string[])
      .map(uid => allProfiles.find(p => p.user_id === uid)?.full_name || uid.slice(0, 8))
      .join('، ');
    const externalNames = (m.external_participants || []).join('، ');

    const detailLines = [
      m.representative ? `نماینده: ${m.representative}` : '',
      m.phone ? `تلفن تماس: ${m.phone}` : '',
      participantNames ? `شرکت‌کنندگان: ${participantNames}` : '',
      notifyNames ? `مطلعین: ${notifyNames}` : '',
      externalNames ? `خارج سازمان: ${externalNames}` : '',
      m.is_online && m.conference_room_id ? `جلسه آنلاین: ${window.location.origin}/?conference=${m.conference_room_id}` : '',
      m.notes ? `یادداشت: ${m.notes}` : '',
      m.priority ? `اولویت: ${{ high: 'بالا', medium: 'متوسط', low: 'پایین' }[m.priority] || m.priority}` : '',
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

  // Current user's personal public calendar — prefer is_personal_public=true, fall back to any type='public'
  const myPublicCalendar = useMemo(() =>
    calendars.find(c => c.is_personal_public && c.type === 'public') ||
    calendars.find(c => c.type === 'public' && !c.is_occasions) ||
    null,
  [calendars]);

  // ---- Color ----
  const getMeetingColor = useCallback((m: MeetingData): string => {
    // Meetings assigned to me by others → always show in my personal public calendar color
    if (currentUserId && m.user_id !== currentUserId &&
      ((m.participant_user_ids || []).includes(currentUserId) ||
       ((m.notify_users || []) as string[]).includes(currentUserId))) {
      if (myPublicCalendar) return myPublicCalendar.color;
    }
    if (m.calendar_id) {
      const cal = [...calendars, ...subscribedCalendars].find(c => c.id === m.calendar_id);
      if (cal) return cal.color;
    }
    return PRIORITY_COLORS[m.priority || 'medium']?.solid || DEFAULT_CALENDAR_COLOR;
  }, [calendars, subscribedCalendars, currentUserId, myPublicCalendar]);

  // ---- Filter meetings ----
  // Map: owner user_id → set of calendar IDs they own that we subscribed to
  const subscribedOwnerCalendarIds = useMemo(() => {
    const map = new Map<string, string[]>();
    subscribedCalendars.forEach(c => {
      if (!map.has(c.user_id)) map.set(c.user_id, []);
      map.get(c.user_id)!.push(c.id);
    });
    return map;
  }, [subscribedCalendars]);

  // Returns true if we subscribe to any calendar owned by any user in the list
  const isAnyParticipantSubscribed = useCallback((participantIds: string[]) => {
    return participantIds.some(uid => {
      const calIds = subscribedOwnerCalendarIds.get(uid) || [];
      return calIds.some(cid => enabledCalendarIds.has(cid));
    });
  }, [subscribedOwnerCalendarIds, enabledCalendarIds]);

  const meetingsByDate = useMemo(() => {
    const map: Record<string, MeetingData[]> = {};
    // Don't filter by calendar/owner until both user ID and calendars have loaded.
    // This prevents a race where meetings appear then vanish when the two async fetches
    // resolve in the wrong order.
    const calendarsLoaded = enabledCalendarIds.size > 0 || calendars.length > 0;
    let hiddenCalId = 0, hiddenNoCalNoSub = 0, hiddenPublicCalOff = 0;
    visibleMeetings.forEach(m => {
      const isCreator = !!currentUserId && m.user_id === currentUserId;
      const isAssigned = !!currentUserId && !isCreator && (
        (m.participant_user_ids || []).includes(currentUserId) ||
        ((m.notify_users || []) as string[]).includes(currentUserId)
      );

      // If calendars haven't loaded yet or userId is unknown, show all meetings
      if (!currentUserId || !calendarsLoaded) {
        const s = parseRequestDateToDateStr(m.request_date);
        if (!s) return;
        if (!map[s]) map[s] = [];
        map[s].push(m);
        return;
      }

      // Meetings assigned to me → always use my personal public calendar toggle
      if (isAssigned) {
        // If I have a public calendar and it's disabled → hide the meeting
        if (myPublicCalendar && !enabledCalendarIds.has(myPublicCalendar.id)) { hiddenPublicCalOff++; return; }
        // If I have NO public calendar at all → still show (no toggle to apply)
        const s = parseRequestDateToDateStr(m.request_date);
        if (!s) return;
        if (!map[s]) map[s] = [];
        map[s].push(m);
        return;
      }

      // Check if any participant has a calendar we subscribed to (and it's enabled)
      const allParticipants = [m.user_id, ...(m.participant_user_ids || [])];
      const isViaSubscription = isAnyParticipantSubscribed(allParticipants);

      if (m.calendar_id) {
        // Creator's own meetings: respect the calendar toggle strictly
        if (!enabledCalendarIds.has(m.calendar_id) && !isViaSubscription) { hiddenCalId++; return; }
      } else {
        // Creator's meeting without a calendar: respect myPublicCalendar toggle
        if (isCreator) {
          if (myPublicCalendar && !enabledCalendarIds.has(myPublicCalendar.id)) { hiddenPublicCalOff++; return; }
        } else {
          if (!isViaSubscription) { hiddenNoCalNoSub++; return; }
          if (m.members_only) return;
        }
      }

      const s = parseRequestDateToDateStr(m.request_date);
      if (!s) return;
      if (!map[s]) map[s] = [];
      map[s].push(m);
    });
    const shown = Object.values(map).reduce((a, arr) => a + arr.length, 0);
    // Log a sample of what keys are in the map vs what the grid would look up
    const mapKeys = Object.keys(map).slice(0, 5);
    const sampleGridKey1 = jalaaliToYYYYMMDD(currentJy || 1405, currentJm || 4, 1);
    const sampleGridKey2 = jalaaliToYYYYMMDD(currentJy || 1405, currentJm || 4, 15);
    console.log('[CalendarPage] meetingsByDate recomputed: visibleMeetings=' + visibleMeetings.length + ' shown=' + shown + ' hiddenCalId=' + hiddenCalId + ' hiddenNoCalNoSub=' + hiddenNoCalNoSub + ' hiddenPublicCalOff=' + hiddenPublicCalOff + ' currentUserId=' + currentUserId + ' enabledCalendarIds.size=' + enabledCalendarIds.size + ' calendarsLoaded=' + calendarsLoaded + ' myPublicCalendar=' + myPublicCalendar?.id);
    console.log('[CalendarPage] meetingsByDate keys (sample):', mapKeys, '| grid lookup key for day 1:', sampleGridKey1, '| day 15:', sampleGridKey2, '| currentJy/Jm:', currentJy, currentJm);
    return map;
  }, [visibleMeetings, enabledCalendarIds, calendars, currentUserId, isAnyParticipantSubscribed, myPublicCalendar, currentJy, currentJm]);

  const getMeetings = useCallback((jy: number, jm: number, jd: number): MeetingData[] => {
    return meetingsByDate[jalaaliToYYYYMMDD(jy, jm, jd)] || [];
  }, [meetingsByDate]);

  // Convert Gregorian → Hijri (Tabular Islamic calendar algorithm)
  const toHijri = useCallback((date: Date) => {
    const y = date.getFullYear(), mo = date.getMonth() + 1, d = date.getDate();
    const N = d + Math.ceil(29.5001 * (mo - 1)) + (y - 1) * 365 + Math.floor((y - 1) / 4) - Math.floor((y - 1) / 100) + Math.floor((y - 1) / 400) + 1721425.5 - 1948438.5;
    const z = Math.floor(N);
    const a = Math.floor((z - 1) / 10631);
    const b = z - 1 - 10631 * a;
    const c = Math.floor((b - 1) / 354);
    const hy = 30 * a + c + 1;
    const rem = b - 354 * c;
    let hm = 0, hd = 0;
    const monthLengths = [30,29,30,29,30,29,30,29,30,29,30,29];
    let cumDays = 0;
    for (let i = 0; i < 12; i++) {
      if (rem <= cumDays + monthLengths[i]) { hm = i + 1; hd = rem - cumDays; break; }
      cumDays += monthLengths[i];
    }
    return { hy, hm: hm || 12, hd: hd || 29 };
  }, []);

  const getOccasionsForDay = useCallback((jy: number, jm: number, jd: number) => {
    if (!occasionsEnabled) return [];
    const greg = jalaaliToDate(jy, jm, jd);
    const hijri = toHijri(greg);
    return occasions.filter(o =>
      o.calendar_type === 'shamsi'
        ? o.month === jm && o.day === jd
        : o.month === hijri.hm && o.day === hijri.hd
    );
  }, [occasions, toHijri, occasionsEnabled]);

  const todayJ = useMemo(() => toJalaali(new Date()), []);
  const isToday = (jy: number, jm: number, jd: number) => jy === todayJ.jy && jm === todayJ.jm && jd === todayJ.jd;
  const isSelected = (jy: number, jm: number, jd: number) => jy === selectedJy && jm === selectedJm && jd === selectedJd;

  // ---- Navigation ----
  const navigatePrev = () => {
    if (viewMode === 'day') { const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd)); d.setDate(d.getDate() - 1); const j = toJalaali(d); setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd); setCurrentJy(j.jy); setCurrentJm(j.jm); }
    else if (viewMode === 'week') { const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd)); d.setDate(d.getDate() - 7); const j = toJalaali(d); setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd); setCurrentJy(j.jy); setCurrentJm(j.jm); }
    else { let nm = currentJm - 1, ny = currentJy; if (nm < 1) { nm = 12; ny--; } setCurrentJy(ny); setCurrentJm(nm); setSidebarJy(ny); setSidebarJm(nm); }
  };
  const navigateNext = () => {
    if (viewMode === 'day') { const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd)); d.setDate(d.getDate() + 1); const j = toJalaali(d); setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd); setCurrentJy(j.jy); setCurrentJm(j.jm); }
    else if (viewMode === 'week') { const d = new Date(jalaaliToDate(selectedJy, selectedJm, selectedJd)); d.setDate(d.getDate() + 7); const j = toJalaali(d); setSelectedJy(j.jy); setSelectedJm(j.jm); setSelectedJd(j.jd); setCurrentJy(j.jy); setCurrentJm(j.jm); }
    else { let nm = currentJm + 1, ny = currentJy; if (nm > 12) { nm = 1; ny++; } setCurrentJy(ny); setCurrentJm(nm); setSidebarJy(ny); setSidebarJm(nm); }
  };
  const goToToday = () => {
    const { jy, jm, jd } = toJalaali(new Date());
    setCurrentJy(jy); setCurrentJm(jm); setSelectedJy(jy); setSelectedJm(jm); setSelectedJd(jd); setSidebarJy(jy); setSidebarJm(jm);
  };

  const getNavTitle = () => {
    if (viewMode === 'day') return `${selectedJd} ${JALAALI_MONTHS[selectedJm - 1]} ${selectedJy}`;
    if (viewMode === 'week') {
      const start = weekDays[0]; const end = weekDays[6];
      return start && end ? `${start.jd} - ${end.jd} ${JALAALI_MONTHS[start.jm - 1]} ${start.jy}` : '';
    }
    return `${JALAALI_MONTHS[currentJm - 1]} ${currentJy}`;
  };

  // ---- Computed ----
  const weekDays = useMemo((): { jy: number; jm: number; jd: number; weekday: number }[] => {
    if (!selectedJy) return [];
    const selDate = jalaaliToDate(selectedJy, selectedJm, selectedJd);
    const dayOfWeek = selDate.getDay();
    const saturdayOffset = dayOfWeek === 6 ? 0 : -(dayOfWeek + 1);
    const saturday = new Date(selDate);
    saturday.setDate(saturday.getDate() + saturdayOffset);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(saturday); d.setDate(d.getDate() + i); const j = toJalaali(d); return { ...j, weekday: i }; });
  }, [selectedJy, selectedJm, selectedJd]);

  const sidebarMonthDays = useMemo(() => {
    if (!sidebarJy) return [];
    const daysInMonth = getJalaaliMonthDays(sidebarJy, sidebarJm);
    const firstDay = getJalaaliFirstDayOfWeek(sidebarJy, sidebarJm);
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [sidebarJy, sidebarJm]);

  const mainMonthDays = useMemo(() => {
    if (!currentJy) return [];
    const daysInMonth = getJalaaliMonthDays(currentJy, currentJm);
    const firstDay = getJalaaliFirstDayOfWeek(currentJy, currentJm);
    const cells: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [currentJy, currentJm]);

  const listMeetings = useMemo(() => {
    if (!viewMode.startsWith('list')) return [];
    const result: { date: string; jy: number; jm: number; jd: number; meetings: MeetingData[] }[] = [];
    const daysInMonth = getJalaaliMonthDays(currentJy, currentJm);
    for (let d = 1; d <= daysInMonth; d++) {
      const ms = getMeetings(currentJy, currentJm, d);
      if (ms.length > 0) result.push({ date: `${currentJy}/${currentJm}/${d}`, jy: currentJy, jm: currentJm, jd: d, meetings: ms });
    }
    return result;
  }, [viewMode, currentJy, currentJm, getMeetings]);

  // ---- Drag/grid helpers ----
  // Returns the correct inner grid element for slot-from-Y calculations.
  // Week view: weekGridRef (inner div, has negative marginTop offset)
  // Day view:  timeGridRef (also inner div, already offset by negative marginTop)
  const getActiveGridEl = () =>
    (viewMode === 'week' ? weekGridRef.current : dayGridRef.current);

  const getSlotFromY = (y: number, el: HTMLElement): number | null => {
    const rect = el.getBoundingClientRect();
    const relY = y - rect.top;
    // getBoundingClientRect() already reflects the element's negative marginTop,
    // so relY directly maps to the correct midnight-based slot index.
    const slot = Math.floor(relY / slotHeight);
    if (slot < 0 || slot >= (HOURS_END - HOURS_START) * 2) return null;
    return slot;
  };

  const getDayIndexFromX = (x: number): number => {
    if (!weekGridRef.current) return 0;
    const rect = weekGridRef.current.getBoundingClientRect();
    const timeColWidth = 56;
    const gridWidth = rect.width - timeColWidth;
    const relX = rect.right - x;
    const dayW = gridWidth / 7;
    return Math.max(0, Math.min(6, Math.floor(relX / dayW)));
  };

  // Global move/resize handlers
  useEffect(() => {
    const onMove = (clientX: number, clientY: number) => {
      if (dragMoveMeeting) {
        const deltaSlot = Math.round((clientY - dragMoveStartY) / slotHeight);
        const deltaDay = viewMode === 'week' ? getDayIndexFromX(clientX) - getDayIndexFromX(dragMoveStartX) : 0;
        if (deltaSlot !== 0 || deltaDay !== 0) dragMovedRef.current = true;
        setDragMoveCurrentDeltaSlot(deltaSlot);
        if (viewMode === 'week') setDragMoveCurrentDeltaDay(getDayIndexFromX(clientX) - getDayIndexFromX(dragMoveStartX));
      }
      if (resizeMeeting) setResizeCurrentDelta(Math.round((clientY - resizeStartY) / slotHeight));
    };
    const onEnd = async (clientX: number, clientY: number) => {
      if (dragMoveMeeting) {
        const deltaSlot = Math.round((clientY - dragMoveStartY) / SLOT_HEIGHT);
        const deltaDay = viewMode === 'week' ? getDayIndexFromX(clientX) - getDayIndexFromX(dragMoveStartX) : 0;
        if (deltaSlot !== 0 || deltaDay !== 0) {
          const ns = dragMoveOriginalSlot + deltaSlot;
          const ne = dragMoveOriginalEndSlot + deltaSlot;
          if (ns >= 0 && ne <= (HOURS_END - HOURS_START) * 2) {
            let newDate = dragMoveOriginalDate;
            if (deltaDay !== 0 && viewMode === 'week' && dragMoveOriginalDate) {
              const origDate = new Date(dragMoveOriginalDate + 'T00:00:00');
              origDate.setDate(origDate.getDate() + deltaDay);
              newDate = `${origDate.getFullYear()}-${String(origDate.getMonth() + 1).padStart(2, '0')}-${String(origDate.getDate()).padStart(2, '0')}`;
            }
            const updates: any = { start_time: minutesToTime(ns * 30), end_time: minutesToTime(ne * 30), duration: `${minutesToTime(ns * 30)} - ${minutesToTime(ne * 30)}` };
            if (newDate !== dragMoveOriginalDate) updates.request_date = new Date(newDate + 'T12:00:00').toISOString();
            const { error } = await supabase.from('meetings').update(updates).eq('id', dragMoveMeeting.id);
            if (!error) {
              toast.success('جلسه جابجا شد');
              fetchMeetings();
              sendNotification('جلسه جابجا شد', dragMoveMeeting.subject);
              const movedMtg = { ...dragMoveMeeting, start_time: minutesToTime(ns * 30), end_time: minutesToTime(ne * 30) };
              if (currentUserId) await insertNotificationFromTemplate({ userId: currentUserId, category: 'meeting', eventType: 'change', fallbackTitle: 'جلسه جابجا شد', fallbackMessage: `جلسه «${dragMoveMeeting.subject}» جابجا شد`, placeholders: buildMeetingPlaceholders(movedMtg, currentUserId), senderId: currentUserId, actionUrl: 'calendar' });
              const dragPIds = (dragMoveMeeting.participant_user_ids || []);
              const moveParticipants = [...dragPIds, ...((dragMoveMeeting.notify_users || []) as string[])].filter(id => id !== currentUserId);
              if (moveParticipants.length) await Promise.all(moveParticipants.map(uid => insertNotificationFromTemplate({ userId: uid, category: 'meeting', eventType: 'change', audience: dragPIds.includes(uid) ? 'participants' : 'observers', fallbackTitle: 'زمان جلسه تغییر کرد', fallbackMessage: `جلسه «${dragMoveMeeting.subject}» جابجا شد`, placeholders: buildMeetingPlaceholders(movedMtg, uid), senderId: currentUserId, actionUrl: 'calendar' })));
            } else toast.error('خطا');
          }
        }
        setDragMoveMeeting(null); setDragMoveCurrentDeltaSlot(0); setDragMoveCurrentDeltaDay(0);
      }
      if (resizeMeeting) {
        const delta = Math.round((clientY - resizeStartY) / slotHeight);
        if (delta !== 0) {
          const ne = resizeOriginalEndSlot + delta;
          const ss = minutesToSlotIndex(timeToMinutes(resizeMeeting.start_time));
          if (ne > ss && ne <= (HOURS_END - HOURS_START) * 2) {
            const { error } = await supabase.from('meetings').update({ end_time: minutesToTime(ne * 30), duration: `${resizeMeeting.start_time} - ${minutesToTime(ne * 30)}` }).eq('id', resizeMeeting.id);
            if (!error) {
              toast.success('مدت جلسه تغییر کرد');
              fetchMeetings();
              sendNotification('زمان جلسه تغییر کرد', resizeMeeting.subject);
              const resizedMtg = { ...resizeMeeting, end_time: minutesToTime(ne * 30) };
              if (currentUserId) await insertNotificationFromTemplate({ userId: currentUserId, category: 'meeting', eventType: 'change', fallbackTitle: 'مدت جلسه تغییر کرد', fallbackMessage: `جلسه «${resizeMeeting.subject}» مدت آن تغییر کرد`, placeholders: buildMeetingPlaceholders(resizedMtg, currentUserId), senderId: currentUserId, actionUrl: 'calendar' });
              const resizePIds = (resizeMeeting.participant_user_ids || []);
              const resizeParticipants = [...resizePIds, ...((resizeMeeting.notify_users || []) as string[])].filter(id => id !== currentUserId);
              if (resizeParticipants.length) await Promise.all(resizeParticipants.map(uid => insertNotificationFromTemplate({ userId: uid, category: 'meeting', eventType: 'change', audience: resizePIds.includes(uid) ? 'participants' : 'observers', fallbackTitle: 'زمان جلسه تغییر کرد', fallbackMessage: `جلسه «${resizeMeeting.subject}» مدت آن تغییر کرد`, placeholders: buildMeetingPlaceholders(resizedMtg, uid), senderId: currentUserId, actionUrl: 'calendar' })));
            } else toast.error('خطا');
          }
        }
        setResizeMeeting(null); setResizeCurrentDelta(0);
      }
    };
    const mm = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const mu = (e: MouseEvent) => onEnd(e.clientX, e.clientY);
    const tm = (e: TouchEvent) => { e.preventDefault(); onMove(e.touches[0].clientX, e.touches[0].clientY); };
    const tu = (e: TouchEvent) => onEnd(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    if (dragMoveMeeting || resizeMeeting) {
      document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
      document.addEventListener('touchmove', tm, { passive: false }); document.addEventListener('touchend', tu);
    }
    return () => {
      document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu);
      document.removeEventListener('touchmove', tm); document.removeEventListener('touchend', tu);
    };
  }, [dragMoveMeeting, dragMoveStartY, dragMoveStartX, dragMoveOriginalSlot, dragMoveOriginalEndSlot, dragMoveOriginalDate, resizeMeeting, resizeStartY, resizeOriginalEndSlot, viewMode]);

  // Cancel all-day drag on global mouseup
  useEffect(() => {
    const cancel = () => {
      if (allDayDragging) {
        setAllDayDragging(false);
        setAllDayDragStart(null);
        setAllDayDragEnd(null);
      }
    };
    document.addEventListener('mouseup', cancel);
    return () => document.removeEventListener('mouseup', cancel);
  }, [allDayDragging]);

  // New-meeting drag handlers
  const handleGridMouseDown = (e: React.MouseEvent, jy: number, jm: number, jd: number) => {
    const el = getActiveGridEl();
    if (e.button !== 0 || !el) return;
    const slot = getSlotFromY(e.clientY, el);
    if (slot === null) return;
    setIsDragging(true); setDragStartSlot(slot); setDragEndSlot(slot); setDragDate({ jy, jm, jd });
  };
  const handleGridMouseMove = (e: React.MouseEvent) => {
    const el = getActiveGridEl();
    if (!isDragging || !el) return;
    const slot = getSlotFromY(e.clientY, el);
    if (slot !== null) setDragEndSlot(slot);
  };
  const handleGridTouchStart = (e: React.TouchEvent, jy: number, jm: number, jd: number) => {
    const el = getActiveGridEl();
    if (!el) return;
    const slot = getSlotFromY(e.touches[0].clientY, el);
    if (slot === null) return;
    setIsDragging(true); setDragStartSlot(slot); setDragEndSlot(slot); setDragDate({ jy, jm, jd });
  };
  const handleGridTouchMove = (e: React.TouchEvent) => {
    const el = getActiveGridEl();
    if (!isDragging || !el) return;
    e.preventDefault();
    const slot = getSlotFromY(e.touches[0].clientY, el);
    if (slot !== null) setDragEndSlot(slot);
  };
  const commitDrag = () => {
    if (!isDragging || dragStartSlot === null || dragEndSlot === null) { setIsDragging(false); return; }
    const startSlot = Math.min(dragStartSlot, dragEndSlot);
    const endSlot = Math.max(dragStartSlot, dragEndSlot) + 1;
    const mentionData = pendingMentionRef.current;
    setPrefillData({
      startTime: minutesToTime(startSlot * 30), endTime: minutesToTime(endSlot * 30),
      dateJy: dragDate?.jy, dateJm: dragDate?.jm, dateJd: dragDate?.jd,
      meetingId: activePendingSchedule?.meetingId || undefined,
      subject: activePendingSchedule?.meeting.subject || '',
      location: activePendingSchedule?.meeting.location || '',
      representative: activePendingSchedule?.meeting.representative || '',
      phone: activePendingSchedule?.meeting.phone || '',
      notes: mentionData?.notes || activePendingSchedule?.meeting.notes || '',
      participantUserIds: mentionData?.participantUserIds || activePendingSchedule?.meeting.participant_user_ids || [],
    });
    if (mentionData) {
      pendingMentionRef.current = null;
      onPendingMentionConsumed?.();
    }
    setShowMeetingForm(true);
    setIsDragging(false); setDragStartSlot(null); setDragEndSlot(null);
  };

  if (!currentJy) return null;


  return (
    <div className="flex h-full bg-gray-50 dark:bg-gray-900 overflow-hidden" dir="rtl">

      {/* Reminder alert */}
      {reminderAlert && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/50" onClick={() => setReminderAlert(null)} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-bounce-in">
            <div className="bg-amber-500 px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                <Clock className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-white font-bold text-sm">یادآوری جلسه</p>
                <p className="text-white/80 text-xs mt-0.5">
                  {reminderAlert.minutesBefore >= 60
                    ? `${reminderAlert.minutesBefore / 60} ساعت دیگر`
                    : `${reminderAlert.minutesBefore} دقیقه دیگر`}
                </p>
              </div>
            </div>
            <div className="p-5">
              <p className="font-semibold text-gray-900 dark:text-white text-base">{reminderAlert.meeting.subject}</p>
              <div className="mt-2 space-y-1 text-sm text-gray-500 dark:text-gray-400">
                {reminderAlert.meeting.start_time && (
                  <p className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />{reminderAlert.meeting.start_time}{reminderAlert.meeting.end_time ? ` - ${reminderAlert.meeting.end_time}` : ''}</p>
                )}
                {reminderAlert.meeting.location && (
                  <p className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" />{reminderAlert.meeting.location}</p>
                )}
              </div>
              <button onClick={() => setReminderAlert(null)} className="mt-4 w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition-colors">
                باشه، متوجه شدم
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Meeting form */}
      {showMeetingForm && (
        <div className="fixed inset-0 bg-black/40 z-50" onClick={() => { setShowMeetingForm(false); setActivePendingSchedule(null); setPrefillData(null); }}>
          <div
            className="absolute inset-y-0 left-0 w-full max-w-lg bg-white dark:bg-gray-900 shadow-2xl flex flex-col animate-slideInLeft"
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
            onClick={e => e.stopPropagation()}
          >
            <CalendarMeetingForm
              prefillData={prefillData}
              calendars={[...calendars.filter(c => (c.type === 'public' || c.type === 'shared') && !c.is_occasions), ...subscribedCalendars.filter(c => c.type !== 'private' && !c.is_occasions)]}
              onCancel={() => { setShowMeetingForm(false); setActivePendingSchedule(null); setPrefillData(null); }}
              onSuccess={(subject, isUpdate) => { setShowMeetingForm(false); setActivePendingSchedule(null); setPrefillData(null); fetchMeetings(); if (onScheduleComplete) onScheduleComplete(); sendNotification(isUpdate ? 'جلسه ویرایش شد' : 'جلسه ثبت شد', subject || ''); }}
            />
          </div>
        </div>
      )}

      {/* Meeting detail */}
      {detailMeeting && (
        <MeetingDetailModal
          meeting={detailMeeting}
          currentUserId={currentUserId}
          allProfiles={allProfiles}
          calendars={calendars}
          subscribedCalendars={subscribedCalendars}
          getMeetingColor={getMeetingColor}
          onClose={() => setDetailMeeting(null)}
          onEdit={handleEditMeeting}
          onDelete={handleDeleteMeeting}
          onShare={handleShareFromDetail}
          onGoogleCalendar={handleSendToGoogleCalendar}
        />
      )}

      {/* Repeat edit scope dialog */}
      {repeatEditDialog && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/50" onClick={() => setRepeatEditDialog(null)} />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95">
            <div className="bg-blue-600 px-5 py-4">
              <h3 className="text-white font-bold">ویرایش جلسه تکراری</h3>
              <p className="text-blue-100 text-xs mt-1">کدام جلسات تغییر کنند؟</p>
            </div>
            <div className="p-5 space-y-3">
              <button onClick={() => { openEditForm(repeatEditDialog.meeting); setRepeatEditDialog(null); }}
                className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-right group">
                <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-500 transition-colors">
                  <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400 group-hover:text-white" />
                </div>
                <div>
                  <p className="font-semibold text-gray-800 dark:text-white text-sm">فقط این جلسه</p>
                  <p className="text-xs text-gray-400 mt-0.5">تنها همین جلسه تغییر می‌کند</p>
                </div>
              </button>
              <button onClick={async () => {
                const m = repeatEditDialog.meeting;
                const { data: allRepeat } = await supabase.from('meetings').select('id').eq('subject', m.subject).eq('user_id', m.user_id || '').gte('request_date', m.request_date);
                if (allRepeat && allRepeat.length > 0) {
                  const ids = allRepeat.map((r: any) => r.id);
                  openEditForm({ ...m, id: m.id, _editAllIds: ids } as any);
                }
                setRepeatEditDialog(null);
              }}
                className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-orange-500 dark:hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all text-right group">
                <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-orange-500 transition-colors">
                  <RefreshCw className="w-4 h-4 text-orange-600 dark:text-orange-400 group-hover:text-white" />
                </div>
                <div>
                  <p className="font-semibold text-gray-800 dark:text-white text-sm">این و جلسات بعدی</p>
                  <p className="text-xs text-gray-400 mt-0.5">از این جلسه به بعد تغییر می‌کنند</p>
                </div>
              </button>
              <button onClick={async () => {
                const m = repeatEditDialog.meeting;
                const { data: allRepeat } = await supabase.from('meetings').select('id').eq('subject', m.subject).eq('user_id', m.user_id || '');
                if (allRepeat && allRepeat.length > 0) openEditForm({ ...m, id: m.id, _editAllIds: allRepeat.map((r: any) => r.id) } as any);
                setRepeatEditDialog(null);
              }}
                className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-red-500 dark:hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all text-right group">
                <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-red-500 transition-colors">
                  <Users className="w-4 h-4 text-red-600 dark:text-red-400 group-hover:text-white" />
                </div>
                <div>
                  <p className="font-semibold text-gray-800 dark:text-white text-sm">همه جلسات</p>
                  <p className="text-xs text-gray-400 mt-0.5">تمام جلسات تکراری تغییر می‌کنند</p>
                </div>
              </button>
              <button onClick={() => setRepeatEditDialog(null)} className="w-full py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">انصراف</button>
            </div>
          </div>
        </div>
      )}

      {/* Preview popup (rendered inside CalendarViews) */}

      {/* Delete meeting confirmation modal */}
      {deleteMeetingDialog && (() => {
        const meeting = meetings.find(x => x.id === deleteMeetingDialog.id);
        const isOwner = meeting?.user_id === currentUserId;
        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" dir="rtl">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => setDeleteMeetingDialog(null)} />
            <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
              <div className="bg-red-600 px-5 py-4">
                <h3 className="text-white font-bold text-base">حذف جلسه</h3>
                {meeting && <p className="text-red-100 text-xs mt-1 truncate">«{meeting.subject}»</p>}
              </div>
              <div className="p-5 space-y-3">
                {isOwner ? (
                  <>
                    <button
                      onClick={() => handleDeleteMeetingConfirm('revert')}
                      className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-right group"
                    >
                      <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-500 transition-colors">
                        <RotateCcw className="w-4 h-4 text-blue-600 dark:text-blue-400 group-hover:text-white" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-white text-sm">حذف و برگشت به درخواست جلسه</p>
                        <p className="text-xs text-gray-400 mt-0.5">جلسه حذف می‌شود و یک درخواست جلسه جدید با همان اطلاعات ایجاد می‌گردد</p>
                      </div>
                    </button>
                    <button
                      onClick={() => handleDeleteMeetingConfirm('full')}
                      className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-red-500 dark:hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all text-right group"
                    >
                      <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-red-500 transition-colors">
                        <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400 group-hover:text-white" />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-800 dark:text-white text-sm">حذف کامل برای همه</p>
                        <p className="text-xs text-gray-400 mt-0.5">جلسه به طور کامل حذف می‌شود و هیچ رکوردی باقی نمی‌ماند</p>
                      </div>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleDeleteMeetingConfirm('full')}
                    className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-red-500 dark:hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all text-right group"
                  >
                    <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-red-500 transition-colors">
                      <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400 group-hover:text-white" />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-white text-sm">حذف از تقویم من</p>
                      <p className="text-xs text-gray-400 mt-0.5">جلسه فقط از تقویم شما حذف می‌شود</p>
                    </div>
                  </button>
                )}
                <button onClick={() => setDeleteMeetingDialog(null)} className="w-full py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">انصراف</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Month day popup */}
      {monthDayPopup && (() => {
        const { jy, jm, jd, x, y } = monthDayPopup;
        const dm = getMeetings(jy, jm, jd);
        const occ = getOccasionsForDay(jy, jm, jd);
        const dayEvs = getAllDayEventsForDay(jy, jm, jd);
        return (
          <div className="fixed inset-0 z-[55] pointer-events-none" dir="rtl">
            <div ref={monthDayPopupRef}
              className="pointer-events-auto absolute bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 w-72 max-h-80 flex flex-col overflow-hidden"
              style={{
                top: Math.min(y + 4, window.innerHeight - 340),
                left: Math.min(x, window.innerWidth - 300),
              }}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${isToday(jy, jm, jd) ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-white'}`}>{jd}</div>
                  <div>
                    <p className="text-sm font-semibold dark:text-white">{JALAALI_MONTHS[jm - 1]} {jy}</p>
                    <p className="text-xs text-gray-400">{dm.length} جلسه</p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => { setMonthDayPopup(null); setAllDayFormDate({ jy, jm, jd }); setShowAllDayForm(true); }}
                    className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 hover:text-blue-500 transition-colors">
                    <Plus className="w-4 h-4" />
                  </button>
                  <button onClick={() => setMonthDayPopup(null)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="overflow-y-auto flex-1 p-2 space-y-1.5">
                {occ.map(o => (
                  <div key={o.id} className={`px-3 py-1.5 rounded-xl text-xs font-medium ${o.is_holiday ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300' : o.is_celebration ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{o.title}</div>
                ))}
                {dayEvs.map(ev => (
                  <div key={ev.id} className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center justify-between ${ev.type === 'leave' ? 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>
                    <span>{ev.title}</span>
                    <button onClick={async () => { await supabase.from('all_day_events').delete().eq('id', ev.id); fetchAllDayEvents(); }} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                  </div>
                ))}
                {dm.length === 0 && occ.length === 0 && dayEvs.length === 0 && (
                  <div className="text-center py-6 text-gray-400 text-xs">جلسه‌ای ندارد</div>
                )}
                {dm.map(m => {
                  const c = getMeetingColor(m);
                  return (
                    <button key={m.id} onClick={() => { setMonthDayPopup(null); setDetailMeeting(m); }}
                      className="w-full text-right flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold dark:text-white truncate">{m.subject}</p>
                        {m.start_time && <p className="text-[10px] text-gray-400 mt-0.5">{toFarsiTime(m.start_time)}{m.end_time ? ` – ${toFarsiTime(m.end_time)}` : ''}</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="px-3 py-2.5 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
                <button onClick={() => { setMonthDayPopup(null); setSelectedJy(jy); setSelectedJm(jm); setSelectedJd(jd); setViewMode('day'); }}
                  className="w-full py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-colors">
                  نمایش روزانه
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* All-day event form */}
      {showAllDayForm && allDayFormDate && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" dir="rtl">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setShowAllDayForm(false); setAllDayFormTitle(''); setAllDayFormEndDate(null); }} />
          <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-xs overflow-hidden border border-gray-200 dark:border-gray-700">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <span className="text-sm font-semibold text-gray-800 dark:text-white">رویداد کل‌روز</span>
              <button onClick={() => { setShowAllDayForm(false); setAllDayFormTitle(''); setAllDayFormEndDate(null); }} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-4 space-y-3">
              {/* Date range display */}
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {allDayFormEndDate && (allDayFormEndDate.jy !== allDayFormDate.jy || allDayFormEndDate.jm !== allDayFormDate.jm || allDayFormEndDate.jd !== allDayFormDate.jd)
                  ? `${allDayFormDate.jd} ${JALAALI_MONTHS[allDayFormDate.jm - 1]} تا ${allDayFormEndDate.jd} ${JALAALI_MONTHS[allDayFormEndDate.jm - 1]} ${allDayFormDate.jy}`
                  : `${allDayFormDate.jd} ${JALAALI_MONTHS[allDayFormDate.jm - 1]} ${allDayFormDate.jy}`
                }
              </div>

              {/* Type selector */}
              <div className="flex gap-1.5">
                {[{ v: 'meeting', l: 'جلسه' }, { v: 'leave', l: 'مرخصی' }, { v: 'other', l: 'سایر' }].map(opt => (
                  <button key={opt.v} type="button" onClick={() => setAllDayFormType(opt.v as any)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors ${allDayFormType === opt.v
                      ? opt.v === 'leave' ? 'bg-orange-100 border-orange-300 text-orange-700 dark:bg-orange-900/30 dark:border-orange-600 dark:text-orange-300'
                        : opt.v === 'meeting' ? 'bg-sky-100 border-sky-300 text-sky-700 dark:bg-sky-900/30 dark:border-sky-600 dark:text-sky-300'
                        : 'bg-gray-100 border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-500 dark:text-gray-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'}`}>
                    {opt.l}
                  </button>
                ))}
              </div>

              {/* Title input */}
              <input autoFocus type="text" value={allDayFormTitle} onChange={e => setAllDayFormTitle(e.target.value)}
                onKeyDown={async e => {
                  if (e.key === 'Enter' && allDayFormTitle.trim() && currentUserId) {
                    const dates = allDayFormEndDate ? jalaaliDatesBetween(allDayFormDate, allDayFormEndDate) : [allDayFormDate];
                    await supabase.from('all_day_events').insert(dates.map(dt => ({ title: allDayFormTitle.trim(), type: allDayFormType, date_jy: dt.jy, date_jm: dt.jm, date_jd: dt.jd, user_id: currentUserId })));
                    fetchAllDayEvents(); setShowAllDayForm(false); setAllDayFormTitle(''); setAllDayFormEndDate(null);
                  }
                }}
                placeholder="عنوان رویداد..."
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 dark:focus:ring-sky-600 placeholder-gray-300 dark:placeholder-gray-600" />

              {/* Save */}
              <button
                onClick={async () => {
                  if (!allDayFormTitle.trim() || !currentUserId) return;
                  const dates = allDayFormEndDate ? jalaaliDatesBetween(allDayFormDate, allDayFormEndDate) : [allDayFormDate];
                  await supabase.from('all_day_events').insert(dates.map(dt => ({ title: allDayFormTitle.trim(), type: allDayFormType, date_jy: dt.jy, date_jm: dt.jm, date_jd: dt.jd, user_id: currentUserId })));
                  fetchAllDayEvents(); setShowAllDayForm(false); setAllDayFormTitle(''); setAllDayFormEndDate(null);
                }}
                disabled={!allDayFormTitle.trim()}
                className="w-full py-2 text-sm font-semibold rounded-lg transition-colors bg-gray-800 hover:bg-gray-700 dark:bg-gray-100 dark:hover:bg-white text-white dark:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed">
                ذخیره
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit calendar */}
      {showCreateCalendar && (
        <CreateEditCalendarModal
          editingCalendar={editingCalendar}
          form={calendarForm}
          onChange={setCalendarForm}
          onSave={handleSaveCalendar}
          onClose={() => { setShowCreateCalendar(false); setEditingCalendar(null); }}
        />
      )}

      {/* Calendar list */}
      {showCalendarList && (
        <CalendarListModal
          calendars={calendars}
          subscribedCalendars={subscribedCalendars}
          meetings={meetings}
          allProfiles={allProfiles}
          search={calendarListSearch}
          onSearchChange={setCalendarListSearch}
          onShare={cal => { handleOpenSubscriptions(cal); setShowCalendarList(false); }}
          onEdit={cal => { setEditingCalendar(cal); setCalendarForm({ name: cal.name, type: cal.type, description: cal.description || '', is_active: cal.is_active, enable_reminder: cal.enable_reminder, create_online_link: false, show_time_overlap: cal.enable_overlap, free_for_all: true, color: cal.color }); setShowCreateCalendar(true); setShowCalendarList(false); }}
          onDelete={handleDeleteCalendar}
          onClose={() => setShowCalendarList(false)}
        />
      )}

      {/* Subscriptions */}
      {showSubscriptionsModal && subscriptionsCalendar && (
        <SubscriptionsModal
          calendar={subscriptionsCalendar}
          subscriptions={subscriptions}
          allProfiles={allProfiles}
          currentUserId={currentUserId}
          subSearch={subSearch}
          subPermission={subPermission}
          onSearchChange={setSubSearch}
          onPermissionChange={setSubPermission}
          onAdd={handleAddSubscription}
          onRemove={handleRemoveSubscription}
          onUpdatePermission={handleUpdateSubPermission}
          onClose={() => setShowSubscriptionsModal(false)}
        />
      )}

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden flex-row-reverse gap-0">
        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Top bar */}
          <div className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 flex-wrap sm:flex-nowrap">
            {/* Mobile sidebar toggle — only visible on small screens */}
            <button onClick={() => setShowMobileSidebar(true)} className="lg:hidden p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex-shrink-0">
              <Calendar className="w-5 h-5 text-gray-600 dark:text-gray-300" />
            </button>
            {/* Desktop sidebar toggle — only visible on large screens */}
            <button
              onClick={() => setShowDesktopSidebar(v => !v)}
              className={`hidden lg:flex p-1.5 rounded-lg flex-shrink-0 transition-colors ${showDesktopSidebar ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
              title={showDesktopSidebar ? 'پنهان کردن تقویم‌ها' : 'نمایش تقویم‌ها'}
            >
              <PanelRight className="w-4 h-4" />
            </button>
            <button onClick={goToToday} className="px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-white font-medium flex-shrink-0">امروز</button>
            {/* Search button + panel */}
            <div ref={searchRef} className="relative flex-shrink-0">
              <button onClick={() => setShowSearch(v => !v)} className={`p-1.5 rounded-lg transition-colors ${showSearch ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'}`} title="جستجوی جلسات">
                <Search className="w-4 h-4" />
              </button>
              {showSearch && (
                <div className="absolute right-0 top-full mt-1.5 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 z-[70] overflow-hidden" dir="rtl">
                  <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                    <div className="relative">
                      <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                      <input ref={searchInputRef} type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                        placeholder="جستجوی جلسات..." dir="rtl"
                        className="w-full pr-8 pl-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:text-white placeholder-gray-400"
                      />
                    </div>
                  </div>
                  {searchResults.length > 0 ? (
                    <div className="max-h-64 overflow-y-auto py-1">
                      {searchResults.map(m => {
                        const dateStr = parseRequestDateToDateStr(m.request_date);
                        const j = dateStr ? toJalaali(new Date(dateStr + 'T12:00:00')) : null;
                        return (
                          <button key={m.id} onClick={() => navigateToMeeting(m)}
                            className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 text-right transition-colors">
                            <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{m.subject}</p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {j && <span className="text-xs text-gray-400">{j.jy}/{String(j.jm).padStart(2,'0')}/{String(j.jd).padStart(2,'0')}</span>}
                                {m.start_time && <span className="text-xs text-blue-500">{m.start_time}</span>}
                                {m.location && <span className="text-xs text-gray-400 flex items-center gap-0.5"><MapPin className="w-3 h-3" />{m.location}</span>}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : searchQuery.trim() ? (
                    <div className="py-6 text-center text-sm text-gray-400">جلسه‌ای یافت نشد</div>
                  ) : (
                    <div className="py-4 text-center text-xs text-gray-400">موضوع، محل یا نماینده را وارد کنید</div>
                  )}
                </div>
              )}
            </div>
            <button onClick={fetchMeetings} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex-shrink-0"><RefreshCw className="w-4 h-4 text-gray-500 dark:text-gray-400" /></button>
            <button onClick={navigatePrev} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex-shrink-0"><ChevronRight className="w-5 h-5 dark:text-white" /></button>
            <button onClick={navigateNext} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex-shrink-0"><ChevronLeft className="w-5 h-5 dark:text-white" /></button>
            <h2 className="text-sm sm:text-base font-semibold dark:text-white flex-1 text-center min-w-0 truncate">{getNavTitle()}</h2>
            <div className="relative flex-shrink-0">
              <button onClick={() => setShowViewDropdown(o => !o)}
                className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs sm:text-sm border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-white min-w-[70px] sm:min-w-[90px] justify-between">
                <span className="hidden sm:inline">{VIEW_OPTIONS.find(v => v.key === viewMode)?.label || 'روز'}</span>
                <span className="sm:hidden">{VIEW_OPTIONS.find(v => v.key === viewMode)?.label?.slice(0,3) || 'روز'}</span>
                <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
              {showViewDropdown && (
                <div className="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 py-1 z-50 min-w-[130px]">
                  {VIEW_OPTIONS.map(v => (
                    <button key={v.key} onClick={() => { setViewMode(v.key); setShowViewDropdown(false); }}
                      className={`w-full text-right px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 ${viewMode === v.key ? 'text-blue-500 font-semibold' : 'dark:text-white'}`}>
                      {viewMode === v.key && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {canHideOffHours && (viewMode === 'day' || viewMode === 'week') && (
              <button
                onClick={() => setHideOffHours(h => !h)}
                title={hideOffHours ? 'نمایش ساعات غیرکاری' : 'پنهان کردن ساعات غیرکاری'}
                className={`p-1.5 rounded-lg flex-shrink-0 transition-colors ${hideOffHours ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
              >
                <Clock className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* View */}
          <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-900">
            <CalendarViews
              viewMode={viewMode}
              selectedJy={selectedJy} selectedJm={selectedJm} selectedJd={selectedJd}
              currentJy={currentJy} currentJm={currentJm}
              currentTime={currentTime}
              currentUserId={currentUserId}
              getMeetings={getMeetings}
              getMeetingColor={getMeetingColor}
              allProfiles={allProfiles}
              weekDays={weekDays}
              mainMonthDays={mainMonthDays}
              listMeetings={listMeetings}
              getOccasionsForDay={getOccasionsForDay}
              getAllDayEventsForDay={getAllDayEventsForDay}
              fetchAllDayEvents={fetchAllDayEvents}
              isInAllDayDragRange={isInAllDayDragRange}
              slotHeight={slotHeight}
              totalSlots={totalSlots}
              hideOffHours={hideOffHours}
              visibleStartHour={visibleStartHour}
              visibleEndHour={visibleEndHour}
              workStartMin={workStartMin}
              workEndMin={workEndMin}
              isToday={isToday}
              isSelected={isSelected}
              toFarsiTime={toFarsiTime}
              isDragging={isDragging}
              dragStartSlot={dragStartSlot}
              dragEndSlot={dragEndSlot}
              dragDate={dragDate}
              dragMoveMeeting={dragMoveMeeting}
              dragMoveOriginalSlot={dragMoveOriginalSlot}
              dragMoveOriginalEndSlot={dragMoveOriginalEndSlot}
              dragMoveCurrentDeltaSlot={dragMoveCurrentDeltaSlot}
              dragMoveCurrentDeltaDay={dragMoveCurrentDeltaDay}
              dragMovedRef={dragMovedRef}
              setDragMoveMeeting={setDragMoveMeeting}
              setDragMoveStartY={setDragMoveStartY}
              setDragMoveStartX={setDragMoveStartX}
              setDragMoveOriginalSlot={setDragMoveOriginalSlot}
              setDragMoveOriginalEndSlot={setDragMoveOriginalEndSlot}
              setDragMoveCurrentDeltaSlot={setDragMoveCurrentDeltaSlot}
              setDragMoveCurrentDeltaDay={setDragMoveCurrentDeltaDay}
              setDragMoveOriginalDate={setDragMoveOriginalDate}
              resizeMeeting={resizeMeeting}
              resizeOriginalEndSlot={resizeOriginalEndSlot}
              resizeCurrentDelta={resizeCurrentDelta}
              setResizeMeeting={setResizeMeeting}
              setResizeStartY={setResizeStartY}
              setResizeOriginalEndSlot={setResizeOriginalEndSlot}
              setResizeCurrentDelta={setResizeCurrentDelta}
              allDayDragging={allDayDragging}
              allDayDragStart={allDayDragStart}
              allDayDragEnd={allDayDragEnd}
              setAllDayDragStart={setAllDayDragStart}
              setAllDayDragEnd={setAllDayDragEnd}
              setAllDayDragging={setAllDayDragging}
              setAllDayFormDate={setAllDayFormDate}
              setAllDayFormEndDate={setAllDayFormEndDate}
              setShowAllDayForm={setShowAllDayForm}
              timeGridRef={timeGridRef}
              timeScrollRef={timeScrollRef}
              weekGridRef={weekGridRef}
              dayGridRef={dayGridRef}
              previewRef={previewRef}
              handleGridMouseDown={handleGridMouseDown}
              handleGridMouseMove={handleGridMouseMove}
              handleGridTouchStart={handleGridTouchStart}
              handleGridTouchMove={handleGridTouchMove}
              commitDrag={commitDrag}
              handleHourColTouchStart={handleHourColTouchStart}
              handleHourColTouchMove={handleHourColTouchMove}
              handleHourColTouchEnd={handleHourColTouchEnd}
              adjustSlotHeight={adjustSlotHeight}
              handleEditMeeting={handleEditMeeting}
              handleBlockClick={handleBlockClick}
              setSelectedJy={setSelectedJy}
              setSelectedJm={setSelectedJm}
              setSelectedJd={setSelectedJd}
              setViewMode={setViewMode as (v: string) => void}
              setMonthDayPopup={setMonthDayPopup}
              previewMeeting={previewMeeting}
              previewPos={previewPos}
              setPreviewMeeting={setPreviewMeeting}
              setDetailMeeting={setDetailMeeting}
              expandedMeetingId={expandedMeetingId}
              setExpandedMeetingId={setExpandedMeetingId}
            />
          </div>
        </div>

        {/* Sidebar — slide in/out from the right */}
        <div className={`hidden lg:block flex-shrink-0 transition-all duration-300 overflow-hidden ${showDesktopSidebar ? 'w-64 opacity-100' : 'w-0 opacity-0'}`}>
          <div className="w-64 h-full">
          <CalendarSidebar
            sidebarJy={sidebarJy}
            sidebarJm={sidebarJm}
            sidebarMonthDays={sidebarMonthDays}
            onSidebarPrev={() => { let nm = sidebarJm - 1, ny = sidebarJy; if (nm < 1) { nm = 12; ny--; } setSidebarJy(ny); setSidebarJm(nm); }}
            onSidebarNext={() => { let nm = sidebarJm + 1, ny = sidebarJy; if (nm > 12) { nm = 1; ny++; } setSidebarJy(ny); setSidebarJm(nm); }}
            onSidebarMonthClick={() => { setCurrentJy(sidebarJy); setCurrentJm(sidebarJm); }}
            onDayClick={day => { setSelectedJy(sidebarJy); setSelectedJm(sidebarJm); setSelectedJd(day); setCurrentJy(sidebarJy); setCurrentJm(sidebarJm); if (viewMode !== 'day') setViewMode('day'); }}
            isToday={isToday}
            isSelected={isSelected}
            getMeetingsForDay={getMeetings}
            calendars={calendars}
            subscribedCalendars={subscribedCalendars}
            enabledCalendarIds={enabledCalendarIds}
            onToggleCalendar={id => setEnabledCalendarIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; })}
            occasionsEnabled={occasionsEnabled}
            onToggleOccasions={handleToggleOccasions}
            myGroupOpen={myGroupOpen}
            sharedGroupOpen={sharedGroupOpen}
            publicGroupOpen={publicGroupOpen}
            onMyGroupToggle={() => setMyGroupOpen(o => !o)}
            onSharedGroupToggle={() => setSharedGroupOpen(o => !o)}
            onPublicGroupToggle={() => setPublicGroupOpen(o => !o)}
            showOnlyMine={showOnlyMine}
            onShowOnlyMineChange={setShowOnlyMine}
            onNewCalendar={() => { setShowCreateCalendar(true); setEditingCalendar(null); resetCalendarForm(); }}
            onOpenCalendarList={() => setShowCalendarList(true)}
            onShareCalendar={handleOpenSubscriptions}
            onEditCalendar={cal => { setEditingCalendar(cal); setCalendarForm({ name: cal.name, type: cal.type, description: cal.description || '', is_active: cal.is_active, enable_reminder: cal.enable_reminder, create_online_link: false, show_time_overlap: cal.enable_overlap, free_for_all: true, color: cal.color }); setShowCreateCalendar(true); }}
            onDeleteCalendar={handleDeleteCalendar}
          />
          </div>
        </div>
      </div>

      {showViewDropdown && <div className="fixed inset-0 z-40" onClick={() => setShowViewDropdown(false)} />}

      {/* Mobile sidebar drawer */}
      {showMobileSidebar && (
        <div className="fixed inset-0 z-50 lg:hidden" dir="rtl">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowMobileSidebar(false)} />
          <div className="absolute inset-y-0 right-0 w-72 bg-white dark:bg-gray-900 shadow-2xl flex flex-col animate-slideInRight" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <span className="text-sm font-bold dark:text-white">تقویم‌ها</span>
              <button onClick={() => setShowMobileSidebar(false)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                <ChevronRight className="w-5 h-5 dark:text-white" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <CalendarSidebar
                sidebarJy={sidebarJy}
                sidebarJm={sidebarJm}
                sidebarMonthDays={sidebarMonthDays}
                onSidebarPrev={() => { let nm = sidebarJm - 1, ny = sidebarJy; if (nm < 1) { nm = 12; ny--; } setSidebarJy(ny); setSidebarJm(nm); }}
                onSidebarNext={() => { let nm = sidebarJm + 1, ny = sidebarJy; if (nm > 12) { nm = 1; ny++; } setSidebarJy(ny); setSidebarJm(nm); }}
                onSidebarMonthClick={() => { setCurrentJy(sidebarJy); setCurrentJm(sidebarJm); setShowMobileSidebar(false); }}
                onDayClick={day => { setSelectedJy(sidebarJy); setSelectedJm(sidebarJm); setSelectedJd(day); setCurrentJy(sidebarJy); setCurrentJm(sidebarJm); if (viewMode !== 'day') setViewMode('day'); setShowMobileSidebar(false); }}
                isToday={isToday}
                isSelected={isSelected}
                getMeetingsForDay={getMeetings}
                calendars={calendars}
                subscribedCalendars={subscribedCalendars}
                enabledCalendarIds={enabledCalendarIds}
                onToggleCalendar={id => setEnabledCalendarIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; })}
                occasionsEnabled={occasionsEnabled}
                onToggleOccasions={handleToggleOccasions}
                myGroupOpen={myGroupOpen}
                sharedGroupOpen={sharedGroupOpen}
                publicGroupOpen={publicGroupOpen}
                onMyGroupToggle={() => setMyGroupOpen(o => !o)}
                onSharedGroupToggle={() => setSharedGroupOpen(o => !o)}
                onPublicGroupToggle={() => setPublicGroupOpen(o => !o)}
                showOnlyMine={showOnlyMine}
                onShowOnlyMineChange={setShowOnlyMine}
                onNewCalendar={() => { setShowCreateCalendar(true); setEditingCalendar(null); resetCalendarForm(); setShowMobileSidebar(false); }}
                onOpenCalendarList={() => { setShowCalendarList(true); setShowMobileSidebar(false); }}
                onShareCalendar={cal => { handleOpenSubscriptions(cal); setShowMobileSidebar(false); }}
                onEditCalendar={cal => { setEditingCalendar(cal); setCalendarForm({ name: cal.name, type: cal.type, description: cal.description || '', is_active: cal.is_active, enable_reminder: cal.enable_reminder, create_online_link: false, show_time_overlap: cal.enable_overlap, free_for_all: true, color: cal.color }); setShowCreateCalendar(true); setShowMobileSidebar(false); }}
                onDeleteCalendar={id => { handleDeleteCalendar(id); setShowMobileSidebar(false); }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Meeting Inbox FAB — fixed bottom-right, only visible on calendar page */}
      <MeetingInboxButton />
    </div>
  );
}
