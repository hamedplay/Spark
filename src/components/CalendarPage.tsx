import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { usePermissions } from '../context/PermissionsContext';
import { CalendarViews } from './Calendar/CalendarViews';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { MeetingInboxButton } from './MeetingInboxButton';
import { useUserPreferences } from '../features/user-preferences';

import { MeetingData, PendingSchedule } from './Calendar/types';
import {
  SLOT_HEIGHT, HOURS_START, HOURS_END,
  toJalaali, jalaaliToDate,
  parseRequestDateToDateStr, jalaaliDatesBetween,
  timeToMinutes,
} from './Calendar/utils';
import { useOrgUsers, resolveUserDisplay } from '../lib/useOrgUsers';
import { MeetingDetailModal } from './Calendar/MeetingDetailModal';
import { CreateEditCalendarModal } from './Calendar/CreateEditCalendarModal';
import { SubscriptionsModal } from './Calendar/SubscriptionsModal';
import { CalendarListModal } from './Calendar/CalendarListModal';
import { ReminderAlertModal } from './Calendar/ReminderAlertModal';
import { RepeatEditDialog } from './Calendar/RepeatEditDialog';
import { DeleteMeetingDialog } from './Calendar/DeleteMeetingDialog';
import { MonthDayPopup } from './Calendar/MonthDayPopup';
import { AllDayEventForm } from './Calendar/AllDayEventForm';
import { MoveConfirmDialog } from './Calendar/MoveConfirmDialog';
import { ResizeConfirmDialog } from './Calendar/ResizeConfirmDialog';
import { CalendarTopBar } from './Calendar/CalendarTopBar';
import { MeetingFormDrawer } from './Calendar/MeetingFormDrawer';
import { CalendarSidebarSection } from './Calendar/CalendarSidebarSection';
import { useCalendarData } from './Calendar/useCalendarData';
import { useCalendarDragResize } from './Calendar/useCalendarDragResize';
import { useCalendarDialogs } from './Calendar/useCalendarDialogs';
import { useCalendarViewProps } from './Calendar/useCalendarViewProps';
import { useCalendarMeetings } from './Calendar/useCalendarMeetings';
import { useCalendarNavigation } from './Calendar/useCalendarNavigation';

type ViewMode = 'month' | 'week' | 'day' | 'list-week' | 'list-month';

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
  const { prefs, updatePrefs, loading: prefsLoading } = useUserPreferences();
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
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

  const [sidebarJy, setSidebarJy] = useState(0);
  const [sidebarJm, setSidebarJm] = useState(0);

  const [showOnlyMine, setShowOnlyMine] = useState(false);
  const [myGroupOpen, setMyGroupOpen] = useState(true);
  const [sharedGroupOpen, setSharedGroupOpen] = useState(true);
  const [publicGroupOpen, setPublicGroupOpen] = useState(true);

  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [showDesktopSidebar, setShowDesktopSidebar] = useState(true);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const timeGridRef = useRef<HTMLDivElement | null>(null);
  const timeScrollRef = useRef<HTMLDivElement | null>(null);
  const listScrollRef = useRef<HTMLDivElement | null>(null);

  const [slotHeight, setSlotHeight] = useState(SLOT_HEIGHT);
  const adjustSlotHeight = (delta: number) => {
    setSlotHeight(prev => Math.min(120, Math.max(20, prev + delta)));
  };

  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartHeightRef = useRef<number>(SLOT_HEIGHT);

  const handleHourColTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.sqrt(dx * dx + dy * dy);
      pinchStartHeightRef.current = slotHeight;
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

  const [workStartMin, setWorkStartMin] = useState(420);
  const [workEndMin, setWorkEndMin] = useState(1170);

  const { hasPermission } = usePermissions();
  const [hideOffHours, setHideOffHours] = useState(false);
  const canHideOffHours = hasPermission('calendar_hide_offhours');

  useEffect(() => {
    if (!prefsLoading) setHideOffHours(prefs.hide_offhours);
  }, [prefs.hide_offhours, prefsLoading]);

  const visibleStartMin = hideOffHours ? Math.max(HOURS_START * 60, workStartMin - 60) : HOURS_START * 60;
  const visibleEndMin = hideOffHours ? Math.min(HOURS_END * 60, workEndMin + 60) : HOURS_END * 60;
  const visibleStartHour = Math.floor(visibleStartMin / 60);
  const visibleEndHour = Math.ceil(visibleEndMin / 60);

  useEffect(() => {
    supabase.from('system_config').select('key,value').eq('section', 'regional')
      .in('key', ['work_start_time', 'work_end_time']).then(({ data }) => {
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
        });
      });
  }, []);

  useEffect(() => {
    if (prefsLoading) return;
    if (prefs.work_start_time) {
      const m = timeToMinutes(prefs.work_start_time);
      if (m >= 0) setWorkStartMin(m);
    }
    if (prefs.work_end_time) {
      const m = timeToMinutes(prefs.work_end_time);
      if (m >= 0) setWorkEndMin(m);
    }
  }, [prefs.work_start_time, prefs.work_end_time, prefsLoading]);

  const fetchMeetingsRef = useRef<() => void>(() => {});
  const fetchCalendarsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const fetchAllDayEventsRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const { usersById, allUsers, loading: orgUsersLoading } = useOrgUsers('');
  const resolveName = useCallback((uid: string) =>
    resolveUserDisplay(usersById, uid, undefined, orgUsersLoading),
  [usersById, orgUsersLoading]);

  const data = useCalendarData(
    currentJy, currentJm, resolveName,
    fetchMeetingsRef, fetchCalendarsRef, fetchAllDayEventsRef,
  );

  const { usersById: usersByIdLive } = useOrgUsers(data.currentUserId || '');
  const resolveNameLive = useCallback((uid: string) =>
    resolveUserDisplay(usersByIdLive, uid, undefined, orgUsersLoading),
  [usersByIdLive, orgUsersLoading]);

  const sendNotification = useCallback((title: string, body: string, icon?: string) => {
    if (!('Notification' in window)) return;
    const doSend = () => new Notification(title, { body, icon: icon || '/icons/icon-192x192.png', dir: 'rtl', lang: 'fa' });
    if (Notification.permission === 'granted') doSend();
    else if (Notification.permission !== 'denied') Notification.requestPermission().then(p => { if (p === 'granted') doSend(); });
  }, []);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const firedRemindersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const checkReminders = () => {
      if (!data.currentUserId || !data.meetings.length) return;
      const now = new Date();
      const IST_OFFSET_MS = 210 * 60 * 1000;
      const tehranNow = new Date(now.getTime() + IST_OFFSET_MS);
      const todayStr = `${tehranNow.getUTCFullYear()}-${String(tehranNow.getUTCMonth()+1).padStart(2,'0')}-${String(tehranNow.getUTCDate()).padStart(2,'0')}`;
      data.meetings.forEach(m => {
        if (!m.reminder_minutes || m.reminder_minutes === 0) return;
        if (!m.start_time) return;
        const isParticipant = m.user_id === data.currentUserId ||
          (m.participant_user_ids || []).includes(data.currentUserId || '') ||
          ((m.notify_users || []) as string[]).includes(data.currentUserId || '');
        if (!isParticipant) return;

        const dateStr = parseRequestDateToDateStr(m.request_date);
        if (dateStr !== todayStr) return;

        const [hh, mm] = m.start_time.split(':').map(Number);
        const meetingMs = new Date(todayStr + 'T00:00:00').getTime() + (hh * 60 + mm) * 60000;
        const reminderMs = meetingMs - m.reminder_minutes * 60000;
        const nowMs = now.getTime();
        const key = `${m.id}-${m.reminder_minutes}`;

        if (nowMs >= reminderMs && nowMs < reminderMs + 30000 && !firedRemindersRef.current.has(key)) {
          firedRemindersRef.current.add(key);
          const label = m.reminder_minutes >= 60
            ? `${m.reminder_minutes / 60} ساعت`
            : `${m.reminder_minutes} دقیقه`;
          const body = `جلسه "${m.subject}" ${label} دیگر شروع می‌شود — ${m.start_time}`;
          sendNotification('یادآوری جلسه', body);
          data.setReminderAlert({ meeting: m, minutesBefore: m.reminder_minutes });
        }
      });
    };
    const iv = setInterval(() => { setCurrentTime(new Date()); checkReminders(); }, 30000);
    checkReminders();
    return () => clearInterval(iv);
  }, [data.meetings, data.currentUserId, sendNotification]);

  const pendingMentionRef = React.useRef<{ participantUserIds?: string[]; notes?: string } | null>(null);
  useEffect(() => {
    if ((pendingMentionParticipants && pendingMentionParticipants.length > 0) || pendingMentionNotes) {
      pendingMentionRef.current = {
        ...(pendingMentionParticipants && pendingMentionParticipants.length > 0 ? { participantUserIds: pendingMentionParticipants } : {}),
        ...(pendingMentionNotes ? { notes: pendingMentionNotes } : {}),
      };
      import('react-hot-toast').then(({ default: toast }) => {
        toast('زمان جلسه را در تقویم انتخاب (درگ) کنید', { duration: 5000, icon: '📅' });
      });
    } else {
      pendingMentionRef.current = null;
    }
  }, [pendingMentionParticipants, pendingMentionNotes]);

  const dialogs = useCalendarDialogs(
    data.meetings, data.currentUserId, resolveNameLive,
    () => data.fetchMeetings(), () => data.fetchCalendars(), () => data.fetchAllDayEvents(),
    data.insertNotification, data.buildMeetingPlaceholders,
    data.calendars, usersByIdLive,
    pendingSchedule,
  );

  const drag = useCalendarDragResize(
    viewMode, slotHeight,
    () => data.fetchMeetings(), sendNotification, data.buildMeetingPlaceholders,
    data.currentUserId,
    dialogs.setPrefillData, dialogs.setShowMeetingForm,
    dialogs.activePendingSchedule,
    pendingMentionRef, onPendingMentionConsumed,
  );

  (window as any).__calendarDragMovedRef = drag.dragMovedRef;

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return data.meetings.filter(m =>
      m.subject?.toLowerCase().includes(q) ||
      m.location?.toLowerCase().includes(q) ||
      m.representative?.toLowerCase().includes(q)
    );
  }, [data.meetings, searchQuery]);



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
    setTimeout(() => dialogs.setDetailMeeting(m), 100);
  };

  useEffect(() => {
    if (showSearch && searchInputRef.current) searchInputRef.current.focus();
  }, [showSearch]);

  const prefViewApplied = useRef(false);
  useEffect(() => {
    if (prefViewApplied.current) return;
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

  const [allDayDragStart, setAllDayDragStart] = useState<{ jy: number; jm: number; jd: number } | null>(null);
  const [allDayDragEnd, setAllDayDragEnd] = useState<{ jy: number; jm: number; jd: number } | null>(null);
  const [allDayDragging, setAllDayDragging] = useState(false);

  const isInAllDayDragRange = (jy: number, jm: number, jd: number) => {
    if (!allDayDragStart || !allDayDragEnd) return false;
    const startG = jalaaliToDate(allDayDragStart.jy, allDayDragStart.jm, allDayDragStart.jd);
    const endG = jalaaliToDate(allDayDragEnd.jy, allDayDragEnd.jm, allDayDragEnd.jd);
    const [from, to] = startG <= endG ? [startG, endG] : [endG, startG];
    const cur = jalaaliToDate(jy, jm, jd);
    return cur >= from && cur <= to;
  };

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

  useEffect(() => {
    if (!initialView) return;
    setViewMode(initialView);
    onViewConsumed?.();
  }, [initialView]);

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

  useEffect(() => {
    if (!sparkCalendarMeetingPrefill) return;
    dialogs.setPrefillData(sparkCalendarMeetingPrefill);
    dialogs.setShowMeetingForm(true);
    onSparkCalendarMeetingPrefillConsumed?.();
  }, [sparkCalendarMeetingPrefill]);

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

  useEffect(() => {
    if (viewMode !== 'list-month') return;
    const timer = setTimeout(() => {
      if (!listScrollRef.current) return;
      const todayEl = listScrollRef.current.querySelector('[data-today="true"]') as HTMLElement | null;
      if (todayEl) {
        const containerTop = listScrollRef.current.getBoundingClientRect().top;
        const elTop = todayEl.getBoundingClientRect().top;
        listScrollRef.current.scrollTop += elTop - containerTop - 16;
      }
    }, 80);
    return () => clearTimeout(timer);
  }, [viewMode, currentJy, currentJm]);

  const calMeetings = useCalendarMeetings({
    meetings: data.meetings,
    enabledCalendarIds: data.enabledCalendarIds,
    calendars: data.calendars,
    subscribedCalendars: data.subscribedCalendars,
    currentUserId: data.currentUserId,
    showPastMeetings: prefs.show_past_meetings,
    showCancelledMeetings: prefs.show_cancelled_meetings,
    currentJy, currentJm,
  });
  const { getMeetingColor, getMeetings } = calMeetings;

  const nav = useCalendarNavigation(
    viewMode, currentJy, currentJm, setCurrentJy, setCurrentJm,
    selectedJy, selectedJm, selectedJd, setSelectedJy, setSelectedJm, setSelectedJd,
    sidebarJy, sidebarJm, setSidebarJy, setSidebarJm, setViewMode,
    getMeetings, data.occasions, data.occasionsEnabled,
  );
  const {
    weekDays, sidebarMonthDays, mainMonthDays, listMeetings,
    getNavTitle, toFarsiTime, getOccasionsForDay,
    isToday, isSelected, navigatePrev, navigateNext, goToToday,
  } = nav;

  const totalSlots = (HOURS_END - HOURS_START) * 2;

  const viewProps = useCalendarViewProps({
    viewMode, selectedJy, selectedJm, selectedJd,
    currentJy, currentJm, currentTime, currentUserId: data.currentUserId,
    getMeetings, getMeetingColor, resolveName: resolveNameLive,
    weekDays, mainMonthDays, listMeetings,
    getOccasionsForDay, getAllDayEventsForDay: data.getAllDayEventsForDay,
    fetchAllDayEvents: data.fetchAllDayEvents,
    isInAllDayDragRange,
    slotHeight, totalSlots,
    hideOffHours, visibleStartHour, visibleEndHour, workStartMin, workEndMin,
    isToday, isSelected, toFarsiTime,
    timeGridRef, timeScrollRef, listScrollRef,
    handleHourColTouchStart, handleHourColTouchMove, handleHourColTouchEnd,
    adjustSlotHeight, setViewMode,
    drag, dialogs,
  });

  // Patch the setters that need the real state setters
  const calendarViewsProps = {
    ...viewProps,
    allDayDragging,
    allDayDragStart,
    allDayDragEnd,
    setAllDayDragStart,
    setAllDayDragEnd,
    setAllDayDragging,
    setSelectedJy,
    setSelectedJm,
    setSelectedJd,
  };

  if (!currentJy) return null;

  return (
    <div className="flex h-full bg-gray-50 dark:bg-gray-900 overflow-hidden" dir="rtl">

      {/* Reminder alert */}
      {dialogs.reminderAlert && (
        <ReminderAlertModal alert={dialogs.reminderAlert} onClose={() => dialogs.setReminderAlert(null)} />
      )}

      {/* Meeting form */}
      {dialogs.showMeetingForm && (
        <MeetingFormDrawer
          prefillData={dialogs.prefillData}
          calendars={data.calendars}
          subscribedCalendars={data.subscribedCalendars}
          onCancel={() => { dialogs.setShowMeetingForm(false); dialogs.setActivePendingSchedule(null); dialogs.setPrefillData(null); }}
          onSuccess={(subject, isUpdate) => { dialogs.setShowMeetingForm(false); dialogs.setActivePendingSchedule(null); dialogs.setPrefillData(null); data.fetchMeetings(); if (onScheduleComplete) onScheduleComplete(); sendNotification(isUpdate ? 'جلسه ویرایش شد' : 'جلسه ثبت شد', subject || ''); }}
        />
      )}

      {/* Meeting detail */}
      {dialogs.detailMeeting && (
        <MeetingDetailModal
          meeting={dialogs.detailMeeting}
          currentUserId={data.currentUserId}
          resolveName={resolveNameLive}
          calendars={data.calendars}
          subscribedCalendars={data.subscribedCalendars}
          getMeetingColor={getMeetingColor}
          onClose={() => dialogs.setDetailMeeting(null)}
          onEdit={dialogs.handleEditMeeting}
          onDelete={dialogs.handleDeleteMeeting}
          onShare={dialogs.handleShareFromDetail}
          onGoogleCalendar={dialogs.handleSendToGoogleCalendar}
        />
      )}

      {/* Repeat edit scope dialog */}
      {dialogs.repeatEditDialog && (
        <RepeatEditDialog
          meeting={dialogs.repeatEditDialog.meeting}
          onEditSingle={() => { dialogs.openEditForm(dialogs.repeatEditDialog!.meeting); dialogs.setRepeatEditDialog(null); }}
          onEditFollowing={async () => {
            const m = dialogs.repeatEditDialog!.meeting;
            const { data: allRepeat } = await supabase.from('meetings').select('id').eq('subject', m.subject).eq('user_id', m.user_id || '').gte('request_date', m.request_date);
            if (allRepeat && allRepeat.length > 0) {
              const ids = allRepeat.map((r: any) => r.id);
              dialogs.openEditForm({ ...m, id: m.id, _editAllIds: ids } as any);
            }
            dialogs.setRepeatEditDialog(null);
          }}
          onEditAll={async () => {
            const m = dialogs.repeatEditDialog!.meeting;
            const { data: allRepeat } = await supabase.from('meetings').select('id').eq('subject', m.subject).eq('user_id', m.user_id || '');
            if (allRepeat && allRepeat.length > 0) dialogs.openEditForm({ ...m, id: m.id, _editAllIds: allRepeat.map((r: any) => r.id) } as any);
            dialogs.setRepeatEditDialog(null);
          }}
          onClose={() => dialogs.setRepeatEditDialog(null)}
        />
      )}

      {/* Preview popup (rendered inside CalendarViews) */}

      {/* Delete meeting confirmation modal */}
      {dialogs.deleteMeetingDialog && (() => {
        const meeting = data.meetings.find(x => x.id === dialogs.deleteMeetingDialog!.id);
        const isOwner = meeting?.user_id === data.currentUserId;
        return (
          <DeleteMeetingDialog
            meeting={meeting}
            isOwner={isOwner}
            onRevert={() => dialogs.handleDeleteMeetingConfirm('revert')}
            onFull={() => dialogs.handleDeleteMeetingConfirm('full')}
            onClose={() => dialogs.setDeleteMeetingDialog(null)}
          />
        );
      })()}

      {/* Month day popup */}
      {dialogs.monthDayPopup && (() => {
        const { jy, jm, jd, x, y } = dialogs.monthDayPopup;
        const dm = getMeetings(jy, jm, jd);
        const occ = getOccasionsForDay(jy, jm, jd);
        const dayEvs = data.getAllDayEventsForDay(jy, jm, jd);
        return (
          <MonthDayPopup
            jy={jy} jm={jm} jd={jd} x={x} y={y}
            meetings={dm} occasions={occ} dayEvents={dayEvs}
            isToday={isToday} toFarsiTime={toFarsiTime} getMeetingColor={getMeetingColor}
            popupRef={dialogs.monthDayPopupRef}
            onCreateMeeting={() => { dialogs.setMonthDayPopup(null); dialogs.handleCreateMeetingForDay(jy, jm, jd); }}
            onCreateAllDay={() => { dialogs.setMonthDayPopup(null); dialogs.setAllDayFormDate({ jy, jm, jd }); dialogs.setShowAllDayForm(true); }}
            onDeleteAllDay={async (id) => { await supabase.from('all_day_events').delete().eq('id', id); data.fetchAllDayEvents(); }}
            onMeetingClick={(m) => { dialogs.setMonthDayPopup(null); dialogs.setDetailMeeting(m); }}
            onDayView={() => { dialogs.setMonthDayPopup(null); setSelectedJy(jy); setSelectedJm(jm); setSelectedJd(jd); setViewMode('day'); }}
            onClose={() => dialogs.setMonthDayPopup(null)}
          />
        );
      })()}

      {/* All-day event form */}
      {dialogs.showAllDayForm && dialogs.allDayFormDate && (
        <AllDayEventForm
          formDate={dialogs.allDayFormDate}
          formEndDate={dialogs.allDayFormEndDate}
          title={dialogs.allDayFormTitle}
          type={dialogs.allDayFormType}
          currentUserId={data.currentUserId}
          onTitleChange={dialogs.setAllDayFormTitle}
          onTypeChange={dialogs.setAllDayFormType}
          onSave={async () => {
            if (!dialogs.allDayFormTitle.trim() || !data.currentUserId) return;
            const dates = dialogs.allDayFormEndDate ? jalaaliDatesBetween(dialogs.allDayFormDate, dialogs.allDayFormEndDate) : [dialogs.allDayFormDate];
            await supabase.from('all_day_events').insert(dates.map(dt => ({ title: dialogs.allDayFormTitle.trim(), type: dialogs.allDayFormType, date_jy: dt.jy, date_jm: dt.jm, date_jd: dt.jd, user_id: data.currentUserId })));
            data.fetchAllDayEvents(); dialogs.setShowAllDayForm(false); dialogs.setAllDayFormTitle(''); dialogs.setAllDayFormEndDate(null);
          }}
          onClose={() => { dialogs.setShowAllDayForm(false); dialogs.setAllDayFormTitle(''); dialogs.setAllDayFormEndDate(null); }}
        />
      )}

      {/* Create/Edit calendar */}
      {dialogs.showCreateCalendar && (
        <CreateEditCalendarModal
          editingCalendar={dialogs.editingCalendar}
          form={dialogs.calendarForm}
          onChange={dialogs.setCalendarForm}
          onSave={dialogs.handleSaveCalendar}
          onClose={() => { dialogs.setShowCreateCalendar(false); dialogs.setEditingCalendar(null); }}
        />
      )}

      {/* Calendar list */}
      {dialogs.showCalendarList && (
        <CalendarListModal
          calendars={data.calendars}
          subscribedCalendars={data.subscribedCalendars}
          meetings={data.meetings}
          allUsers={allUsers}
          resolveName={resolveNameLive}
          search={dialogs.calendarListSearch}
          onSearchChange={dialogs.setCalendarListSearch}
          onShare={cal => { dialogs.handleOpenSubscriptions(cal); dialogs.setShowCalendarList(false); }}
          onEdit={cal => { dialogs.setEditingCalendar(cal); dialogs.setCalendarForm({ name: cal.name, type: cal.type, description: cal.description || '', is_active: cal.is_active, enable_reminder: cal.enable_reminder, create_online_link: false, show_time_overlap: cal.enable_overlap, free_for_all: true, color: cal.color }); dialogs.setShowCreateCalendar(true); dialogs.setShowCalendarList(false); }}
          onDelete={dialogs.handleDeleteCalendar}
          onClose={() => dialogs.setShowCalendarList(false)}
        />
      )}

      {/* Subscriptions */}
      {dialogs.showSubscriptionsModal && dialogs.subscriptionsCalendar && (
        <SubscriptionsModal
          calendar={dialogs.subscriptionsCalendar}
          subscriptions={dialogs.subscriptions}
          allUsers={allUsers}
          resolveName={resolveNameLive}
          currentUserId={data.currentUserId}
          subSearch={dialogs.subSearch}
          subPermission={dialogs.subPermission}
          onSearchChange={dialogs.setSubSearch}
          onPermissionChange={dialogs.setSubPermission}
          onAdd={dialogs.handleAddSubscription}
          onRemove={dialogs.handleRemoveSubscription}
          onUpdatePermission={dialogs.handleUpdateSubPermission}
          onClose={() => dialogs.setShowSubscriptionsModal(false)}
        />
      )}

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden flex-row-reverse gap-0">
        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Top bar */}
          <CalendarTopBar
            viewMode={viewMode}
            navTitle={getNavTitle()}
            isRefreshing={data.isRefreshing}
            showDesktopSidebar={showDesktopSidebar}
            showSearch={showSearch}
            showViewDropdown={showViewDropdown}
            searchQuery={searchQuery}
            hideOffHours={hideOffHours}
            canHideOffHours={canHideOffHours}
            hasHideOffHoursPref={prefs.hide_offhours !== undefined}
            searchRef={searchRef}
            searchInputRef={searchInputRef}
            onToggleMobileSidebar={() => setShowMobileSidebar(true)}
            onToggleDesktopSidebar={() => setShowDesktopSidebar(v => !v)}
            onGoToToday={goToToday}
            onToggleSearch={() => setShowSearch(v => !v)}
            onSearchChange={setSearchQuery}
            onRefresh={() => data.fetchMeetings()}
            onNavigatePrev={navigatePrev}
            onNavigateNext={navigateNext}
            onToggleViewDropdown={() => setShowViewDropdown(o => !o)}
            onViewModeChange={(v) => { setViewMode(v); setShowViewDropdown(false); }}
            onToggleHideOffHours={() => { const next = !hideOffHours; setHideOffHours(next); updatePrefs({ hide_offhours: next }); }}
            searchResults={searchResults}
            onNavigateToMeeting={navigateToMeeting}
          />

          {/* View */}
          <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-900">
            <CalendarViews {...calendarViewsProps} />
          </div>
        </div>

      </div>

      {showViewDropdown && <div className="fixed inset-0 z-40" onClick={() => setShowViewDropdown(false)} />}

      <CalendarSidebarSection
        showDesktopSidebar={showDesktopSidebar}
        showMobileSidebar={showMobileSidebar}
        sidebarJy={sidebarJy}
        sidebarJm={sidebarJm}
        sidebarMonthDays={sidebarMonthDays}
        isToday={isToday}
        isSelected={isSelected}
        getMeetingsForDay={getMeetings}
        calendars={data.calendars}
        subscribedCalendars={data.subscribedCalendars}
        enabledCalendarIds={data.enabledCalendarIds}
        occasionsEnabled={data.occasionsEnabled}
        myGroupOpen={myGroupOpen}
        sharedGroupOpen={sharedGroupOpen}
        publicGroupOpen={publicGroupOpen}
        showOnlyMine={showOnlyMine}
        onToggleMobileSidebar={() => setShowMobileSidebar(false)}
        onToggleCalendar={id => data.setEnabledCalendarIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; })}
        onToggleOccasions={data.handleToggleOccasions}
        onMyGroupToggle={() => setMyGroupOpen(o => !o)}
        onSharedGroupToggle={() => setSharedGroupOpen(o => !o)}
        onPublicGroupToggle={() => setPublicGroupOpen(o => !o)}
        onShowOnlyMineChange={setShowOnlyMine}
        onSidebarPrev={() => { let nm = sidebarJm - 1, ny = sidebarJy; if (nm < 1) { nm = 12; ny--; } setSidebarJy(ny); setSidebarJm(nm); }}
        onSidebarNext={() => { let nm = sidebarJm + 1, ny = sidebarJy; if (nm > 12) { nm = 1; ny++; } setSidebarJy(ny); setSidebarJm(nm); }}
        onSidebarMonthClick={() => { setCurrentJy(sidebarJy); setCurrentJm(sidebarJm); }}
        onDayClick={day => { setSelectedJy(sidebarJy); setSelectedJm(sidebarJm); setSelectedJd(day); setCurrentJy(sidebarJy); setCurrentJm(sidebarJm); if (viewMode !== 'day') setViewMode('day'); }}
        onDayClickMobile={day => { setSelectedJy(sidebarJy); setSelectedJm(sidebarJm); setSelectedJd(day); setCurrentJy(sidebarJy); setCurrentJm(sidebarJm); if (viewMode !== 'day') setViewMode('day'); setShowMobileSidebar(false); }}
        onNewCalendar={() => { dialogs.setShowCreateCalendar(true); dialogs.setEditingCalendar(null); dialogs.resetCalendarForm(); }}
        onNewCalendarMobile={() => { dialogs.setShowCreateCalendar(true); dialogs.setEditingCalendar(null); dialogs.resetCalendarForm(); setShowMobileSidebar(false); }}
        onOpenCalendarList={() => dialogs.setShowCalendarList(true)}
        onOpenCalendarListMobile={() => { dialogs.setShowCalendarList(true); setShowMobileSidebar(false); }}
        onShareCalendar={dialogs.handleOpenSubscriptions}
        onShareCalendarMobile={cal => { dialogs.handleOpenSubscriptions(cal); setShowMobileSidebar(false); }}
        onEditCalendar={cal => { dialogs.setEditingCalendar(cal); dialogs.setCalendarForm({ name: cal.name, type: cal.type, description: cal.description || '', is_active: cal.is_active, enable_reminder: cal.enable_reminder, create_online_link: false, show_time_overlap: cal.enable_overlap, free_for_all: true, color: cal.color }); dialogs.setShowCreateCalendar(true); }}
        onEditCalendarMobile={cal => { dialogs.setEditingCalendar(cal); dialogs.setCalendarForm({ name: cal.name, type: cal.type, description: cal.description || '', is_active: cal.is_active, enable_reminder: cal.enable_reminder, create_online_link: false, show_time_overlap: cal.enable_overlap, free_for_all: true, color: cal.color }); dialogs.setShowCreateCalendar(true); setShowMobileSidebar(false); }}
        onDeleteCalendar={dialogs.handleDeleteCalendar}
        onDeleteCalendarMobile={id => { dialogs.handleDeleteCalendar(id); setShowMobileSidebar(false); }}
      />

      {/* Move confirmation dialog */}
      {drag.pendingMove && (
        <MoveConfirmDialog
          pendingMove={drag.pendingMove}
          onConfirm={drag.commitMove}
          onCancel={() => drag.setPendingMove(null)}
        />
      )}

      {/* Resize confirmation dialog */}
      {drag.pendingResize && (
        <ResizeConfirmDialog
          pendingResize={drag.pendingResize}
          onConfirm={drag.commitResize}
          onCancel={() => drag.setPendingResize(null)}
        />
      )}

      {/* Meeting Inbox FAB — fixed bottom-right, only visible on calendar page */}
      <MeetingInboxButton />
    </div>
  );
}
