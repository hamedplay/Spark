import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { insertNotification as insertNotificationFromTemplate } from '../../lib/notifications';
import toast from 'react-hot-toast';
import {
  HOURS_START, HOURS_END,
  timeToMinutes, minutesToTime, minutesToSlotIndex,
} from './utils';
import type { MeetingData } from './types';

export interface CalendarDragResizeState {
  isDragging: boolean;
  dragStartSlot: number | null;
  dragEndSlot: number | null;
  dragDate: { jy: number; jm: number; jd: number } | null;
  dragMoveMeeting: MeetingData | null;
  dragMoveStartY: number;
  dragMoveStartX: number;
  dragMovedRef: React.RefObject<boolean>;
  dragMoveOriginalSlot: number;
  dragMoveOriginalEndSlot: number;
  dragMoveCurrentDeltaSlot: number;
  dragMoveCurrentDeltaDay: number;
  dragMoveOriginalDate: string;
  pendingMove: {
    meeting: MeetingData;
    updates: Record<string, string>;
    ns: number;
    ne: number;
    oldDateIso: string;
    newDateIso: string;
  } | null;
  setPendingMove: React.Dispatch<React.SetStateAction<{
    meeting: MeetingData;
    updates: Record<string, string>;
    ns: number;
    ne: number;
    oldDateIso: string;
    newDateIso: string;
  } | null>>;
  resizeMeeting: MeetingData | null;
  resizeStartY: number;
  resizeOriginalEndSlot: number;
  resizeCurrentDelta: number;
  pendingResize: {
    meeting: MeetingData;
    newEndTime: string;
  } | null;
  setPendingResize: React.Dispatch<React.SetStateAction<{
    meeting: MeetingData;
    newEndTime: string;
  } | null>>;
  weekGridRef: React.RefObject<HTMLDivElement | null>;
  dayGridRef: React.RefObject<HTMLDivElement | null>;
  setIsDragging: React.Dispatch<React.SetStateAction<boolean>>;
  setDragStartSlot: React.Dispatch<React.SetStateAction<number | null>>;
  setDragEndSlot: React.Dispatch<React.SetStateAction<number | null>>;
  setDragMoveMeeting: React.Dispatch<React.SetStateAction<MeetingData | null>>;
  setDragMoveStartY: React.Dispatch<React.SetStateAction<number>>;
  setDragMoveStartX: React.Dispatch<React.SetStateAction<number>>;
  setDragMoveOriginalSlot: React.Dispatch<React.SetStateAction<number>>;
  setDragMoveOriginalEndSlot: React.Dispatch<React.SetStateAction<number>>;
  setDragMoveCurrentDeltaSlot: React.Dispatch<React.SetStateAction<number>>;
  setDragMoveCurrentDeltaDay: React.Dispatch<React.SetStateAction<number>>;
  setDragMoveOriginalDate: React.Dispatch<React.SetStateAction<string>>;
  setResizeMeeting: React.Dispatch<React.SetStateAction<MeetingData | null>>;
  setResizeStartY: React.Dispatch<React.SetStateAction<number>>;
  setResizeOriginalEndSlot: React.Dispatch<React.SetStateAction<number>>;
  setResizeCurrentDelta: React.Dispatch<React.SetStateAction<number>>;
  getActiveGridEl: () => HTMLDivElement | null;
  getSlotFromY: (y: number, el: HTMLElement) => number | null;
  getDayIndexFromX: (x: number) => number;
  handleGridMouseDown: (e: React.MouseEvent, jy: number, jm: number, jd: number) => void;
  handleGridMouseMove: (e: React.MouseEvent) => void;
  handleGridTouchStart: (e: React.TouchEvent, jy: number, jm: number, jd: number) => void;
  handleGridTouchMove: (e: React.TouchEvent) => void;
  commitDrag: () => void;
  commitMove: () => Promise<void>;
  commitResize: () => Promise<void>;
}

export function useCalendarDragResize(
  viewMode: string,
  slotHeight: number,
  fetchMeetings: () => void,
  sendNotification: (title: string, body: string, icon?: string) => void,
  buildMeetingPlaceholders: (m: MeetingData, recipientId?: string) => Record<string, string>,
  currentUserId: string | null,
  setPrefillData: React.Dispatch<React.SetStateAction<any>>,
  setShowMeetingForm: React.Dispatch<React.SetStateAction<boolean>>,
  activePendingSchedule: PendingSchedule | null,
  pendingMentionRef: React.RefObject<{ participantUserIds?: string[]; notes?: string } | null>,
  onPendingMentionConsumed?: () => void,
): CalendarDragResizeState {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartSlot, setDragStartSlot] = useState<number | null>(null);
  const [dragEndSlot, setDragEndSlot] = useState<number | null>(null);
  const [dragDate, setDragDate] = useState<{ jy: number; jm: number; jd: number } | null>(null);

  const [dragMoveMeeting, setDragMoveMeeting] = useState<MeetingData | null>(null);
  const [dragMoveStartY, setDragMoveStartY] = useState(0);
  const [dragMoveStartX, setDragMoveStartX] = useState(0);
  const dragMovedRef = useRef(false);
  const [dragMoveOriginalSlot, setDragMoveOriginalSlot] = useState(0);
  const [dragMoveOriginalEndSlot, setDragMoveOriginalEndSlot] = useState(0);
  const [dragMoveCurrentDeltaSlot, setDragMoveCurrentDeltaSlot] = useState(0);
  const [dragMoveCurrentDeltaDay, setDragMoveCurrentDeltaDay] = useState(0);
  const [dragMoveOriginalDate, setDragMoveOriginalDate] = useState('');
  const [pendingMove, setPendingMove] = useState<{
    meeting: MeetingData;
    updates: Record<string, string>;
    ns: number;
    ne: number;
    oldDateIso: string;
    newDateIso: string;
  } | null>(null);
  const weekGridRef = useRef<HTMLDivElement | null>(null);
  const dayGridRef = useRef<HTMLDivElement | null>(null);

  const [resizeMeeting, setResizeMeeting] = useState<MeetingData | null>(null);
  const [resizeStartY, setResizeStartY] = useState(0);
  const [resizeOriginalEndSlot, setResizeOriginalEndSlot] = useState(0);
  const [resizeCurrentDelta, setResizeCurrentDelta] = useState(0);
  const [pendingResize, setPendingResize] = useState<{
    meeting: MeetingData;
    newEndTime: string;
  } | null>(null);

  const getActiveGridEl = () =>
    (viewMode === 'week' ? weekGridRef.current : dayGridRef.current);

  const getSlotFromY = (y: number, el: HTMLElement): number | null => {
    const rect = el.getBoundingClientRect();
    const relY = y - rect.top;
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
        const deltaSlot = Math.round((clientY - dragMoveStartY) / slotHeight);
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
            const updates: Record<string, string> = { start_time: minutesToTime(ns * 30), end_time: minutesToTime(ne * 30), duration: `${minutesToTime(ns * 30)} - ${minutesToTime(ne * 30)}` };
            if (newDate !== dragMoveOriginalDate) updates.request_date = new Date(newDate + 'T12:00:00').toISOString();
            setPendingMove({ meeting: dragMoveMeeting, updates, ns, ne, oldDateIso: dragMoveOriginalDate, newDateIso: newDate });
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
            setPendingResize({ meeting: resizeMeeting, newEndTime: minutesToTime(ne * 30) });
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
  }, [dragMoveMeeting, dragMoveStartY, dragMoveStartX, dragMoveOriginalSlot, dragMoveOriginalEndSlot, dragMoveOriginalDate, resizeMeeting, resizeStartY, resizeOriginalEndSlot, viewMode, slotHeight]);

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

  const commitMove = async () => {
    const snap = pendingMove;
    if (!snap) return;
    setPendingMove(null);
    const { meeting, updates, ns, ne } = snap;
    const { error } = await supabase.from('meetings').update(updates).eq('id', meeting.id);
    if (!error) {
      toast.success('جلسه جابجا شد');
      fetchMeetings();
      sendNotification('جلسه جابجا شد', meeting.subject);
      const movedMtg = { ...meeting, start_time: minutesToTime(ns * 30), end_time: minutesToTime(ne * 30) };
      if (currentUserId) await insertNotificationFromTemplate({ userId: currentUserId, category: 'meeting', eventType: 'change', fallbackTitle: 'جلسه جابجا شد', fallbackMessage: `جلسه «${meeting.subject}» جابجا شد`, placeholders: buildMeetingPlaceholders(movedMtg, currentUserId), senderId: currentUserId, actionUrl: 'calendar' });
      const dragPIds = (meeting.participant_user_ids || []);
      const moveParticipants = [...dragPIds, ...((meeting.notify_users || []) as string[])].filter(id => id !== currentUserId);
      if (moveParticipants.length) await Promise.all(moveParticipants.map(uid => insertNotificationFromTemplate({ userId: uid, category: 'meeting', eventType: 'change', audience: dragPIds.includes(uid) ? 'participants' : 'observers', fallbackTitle: 'زمان جلسه تغییر کرد', fallbackMessage: `جلسه «${meeting.subject}» جابجا شد`, placeholders: buildMeetingPlaceholders(movedMtg, uid), senderId: currentUserId, actionUrl: 'calendar' })));
    } else toast.error('خطا');
  };

  const commitResize = async () => {
    const snap = pendingResize;
    if (!snap) return;
    setPendingResize(null);
    const { meeting, newEndTime } = snap;
    const { error } = await supabase.from('meetings').update({ end_time: newEndTime, duration: `${meeting.start_time} - ${newEndTime}` }).eq('id', meeting.id);
    if (!error) {
      toast.success('مدت جلسه تغییر کرد');
      fetchMeetings();
      sendNotification('زمان جلسه تغییر کرد', meeting.subject);
      const resizedMtg = { ...meeting, end_time: newEndTime };
      if (currentUserId) await insertNotificationFromTemplate({ userId: currentUserId, category: 'meeting', eventType: 'change', fallbackTitle: 'مدت جلسه تغییر کرد', fallbackMessage: `جلسه «${meeting.subject}» مدت آن تغییر کرد`, placeholders: buildMeetingPlaceholders(resizedMtg, currentUserId), senderId: currentUserId, actionUrl: 'calendar' });
      const resizePIds = (meeting.participant_user_ids || []);
      const resizeParticipants = [...resizePIds, ...((meeting.notify_users || []) as string[])].filter(id => id !== currentUserId);
      if (resizeParticipants.length) await Promise.all(resizeParticipants.map(uid => insertNotificationFromTemplate({ userId: uid, category: 'meeting', eventType: 'change', audience: resizePIds.includes(uid) ? 'participants' : 'observers', fallbackTitle: 'زمان جلسه تغییر کرد', fallbackMessage: `جلسه «${meeting.subject}» مدت آن تغییر کرد`, placeholders: buildMeetingPlaceholders(resizedMtg, uid), senderId: currentUserId, actionUrl: 'calendar' })));
    } else toast.error('خطا');
  };

  return {
    isDragging, dragStartSlot, dragEndSlot, dragDate,
    dragMoveMeeting, dragMoveStartY, dragMoveStartX, dragMovedRef,
    dragMoveOriginalSlot, dragMoveOriginalEndSlot, dragMoveCurrentDeltaSlot, dragMoveCurrentDeltaDay, dragMoveOriginalDate,
    pendingMove, setPendingMove,
    resizeMeeting, resizeStartY, resizeOriginalEndSlot, resizeCurrentDelta,
    pendingResize, setPendingResize,
    weekGridRef, dayGridRef,
    setIsDragging, setDragStartSlot, setDragEndSlot,
    setDragMoveMeeting, setDragMoveStartY, setDragMoveStartX,
    setDragMoveOriginalSlot, setDragMoveOriginalEndSlot,
    setDragMoveCurrentDeltaSlot, setDragMoveCurrentDeltaDay, setDragMoveOriginalDate,
    setResizeMeeting, setResizeStartY, setResizeOriginalEndSlot, setResizeCurrentDelta,
    getActiveGridEl, getSlotFromY, getDayIndexFromX,
    handleGridMouseDown, handleGridMouseMove, handleGridTouchStart, handleGridTouchMove,
    commitDrag, commitMove, commitResize,
  };
}

type PendingSchedule = import('./types').PendingSchedule;
