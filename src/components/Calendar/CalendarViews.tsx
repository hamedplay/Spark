import React from 'react';
import { Clock, MapPin, X, Plus, Users, Calendar, ChevronRight, CalendarPlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { MeetingData } from './types';
import {
  JALAALI_MONTHS, JALAALI_WEEKDAYS,
  HOURS_START, HOURS_END,
  parseRequestDateToDateStr, jalaaliToDate, jsDayToWeekday,
  jalaaliToYYYYMMDD, minutesToTime, timeToMinutes, minutesToSlotIndex,
} from './utils';

export interface CalendarViewProps {
  viewMode: 'month' | 'week' | 'day' | 'list-week' | 'list-month';

  // Date state
  selectedJy: number; selectedJm: number; selectedJd: number;
  currentJy: number; currentJm: number;
  currentTime: Date;
  currentUserId: string | null;

  // Meeting data
  getMeetings: (jy: number, jm: number, jd: number) => MeetingData[];
  getMeetingColor: (m: MeetingData) => string;
  resolveName: (uid: string) => string;
  weekDays: Array<{ jy: number; jm: number; jd: number; weekday: number }>;
  mainMonthDays: Array<number | null>;
  listMeetings: Array<{ date: string; jy: number; jm: number; jd: number; meetings: MeetingData[] }>;

  // Calendar events
  getOccasionsForDay: (jy: number, jm: number, jd: number) => any[];
  getAllDayEventsForDay: (jy: number, jm: number, jd: number) => any[];
  fetchAllDayEvents: () => void;
  isInAllDayDragRange: (jy: number, jm: number, jd: number) => boolean;

  // Time grid
  slotHeight: number;
  totalSlots: number;
  hideOffHours: boolean;
  visibleStartHour: number;
  visibleEndHour: number;
  workStartMin: number;
  workEndMin: number;

  // Computed
  isToday: (jy: number, jm: number, jd: number) => boolean;
  isSelected: (jy: number, jm: number, jd: number) => boolean;
  toFarsiTime: (t: string) => string;

  // Drag state - new meeting
  isDragging: boolean;
  dragStartSlot: number | null;
  dragEndSlot: number | null;
  dragDate: { jy: number; jm: number; jd: number } | null;

  // Drag state - move meeting
  dragMoveMeeting: MeetingData | null;
  dragMoveOriginalSlot: number;
  dragMoveOriginalEndSlot: number;
  dragMoveCurrentDeltaSlot: number;
  dragMoveCurrentDeltaDay: number;
  dragMovedRef: React.MutableRefObject<boolean>;
  setDragMoveMeeting: (m: MeetingData | null) => void;
  setDragMoveStartY: (v: number) => void;
  setDragMoveStartX: (v: number) => void;
  setDragMoveOriginalSlot: (v: number) => void;
  setDragMoveOriginalEndSlot: (v: number) => void;
  setDragMoveCurrentDeltaSlot: (v: number) => void;
  setDragMoveCurrentDeltaDay: (v: number) => void;
  setDragMoveOriginalDate: (v: string) => void;

  // Drag state - resize
  resizeMeeting: MeetingData | null;
  resizeOriginalEndSlot: number;
  resizeCurrentDelta: number;
  setResizeMeeting: (m: MeetingData | null) => void;
  setResizeStartY: (v: number) => void;
  setResizeOriginalEndSlot: (v: number) => void;
  setResizeCurrentDelta: (v: number) => void;

  // All-day drag
  allDayDragging: boolean;
  allDayDragStart: { jy: number; jm: number; jd: number } | null;
  allDayDragEnd: { jy: number; jm: number; jd: number } | null;
  setAllDayDragStart: (v: { jy: number; jm: number; jd: number } | null) => void;
  setAllDayDragEnd: (v: { jy: number; jm: number; jd: number } | null) => void;
  setAllDayDragging: (v: boolean) => void;
  setAllDayFormDate: (v: { jy: number; jm: number; jd: number } | null) => void;
  setAllDayFormEndDate: (v: { jy: number; jm: number; jd: number } | null) => void;
  setShowAllDayForm: (v: boolean) => void;

  // Refs
  timeGridRef: React.MutableRefObject<HTMLDivElement | null>;
  timeScrollRef: React.MutableRefObject<HTMLDivElement | null>;
  weekGridRef: React.MutableRefObject<HTMLDivElement | null>;
  dayGridRef: React.MutableRefObject<HTMLDivElement | null>;
  previewRef: React.MutableRefObject<HTMLDivElement | null>;

  // Grid event handlers
  handleGridMouseDown: (e: React.MouseEvent, jy: number, jm: number, jd: number) => void;
  handleGridMouseMove: (e: React.MouseEvent) => void;
  handleGridTouchStart: (e: React.TouchEvent, jy: number, jm: number, jd: number) => void;
  handleGridTouchMove: (e: React.TouchEvent) => void;
  commitDrag: () => void;
  handleHourColTouchStart: (e: React.TouchEvent) => void;
  handleHourColTouchMove: (e: React.TouchEvent) => void;
  handleHourColTouchEnd: () => void;
  adjustSlotHeight: (delta: number) => void;

  // Meeting handlers
  handleEditMeeting: (m: MeetingData) => void;
  handleBlockClick: (m: MeetingData, e: React.MouseEvent) => void;

  // Navigation setters
  setSelectedJy: (v: number) => void;
  setSelectedJm: (v: number) => void;
  setSelectedJd: (v: number) => void;
  setViewMode: (v: string) => void;

  // Popup setters
  setMonthDayPopup: (v: any) => void;
  onCreateMeetingForDay?: (jy: number, jm: number, jd: number) => void;

  // Preview popup
  previewMeeting: MeetingData | null;
  previewPos: { x: number; y: number };
  setPreviewMeeting: (m: MeetingData | null) => void;
  setDetailMeeting: (m: MeetingData | null) => void;

  // List view
  expandedMeetingId: string | null;
  setExpandedMeetingId: (v: string | null) => void;
  listScrollRef?: React.MutableRefObject<HTMLDivElement | null>;
}

// ─── Overlap computation ───────────────────────────────────────────────────────
interface OverlapInfo {
  meeting: MeetingData;
  leftPct: number;
  widthPct: number;
  zIndex: number;
  isNested: boolean;
}

function computeOverlapLayers(mts: MeetingData[]): OverlapInfo[] {
  const withTime = mts.filter(m => m.start_time && m.end_time);
  if (withTime.length === 0) return [];

  const sorted = [...withTime].sort((a, b) => {
    const durA = timeToMinutes(a.end_time) - timeToMinutes(a.start_time);
    const durB = timeToMinutes(b.end_time) - timeToMinutes(b.start_time);
    if (durB !== durA) return durB - durA;
    return timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
  });

  const groups: MeetingData[][] = [];
  for (const m of sorted) {
    const sMin = timeToMinutes(m.start_time);
    const eMin = timeToMinutes(m.end_time);
    let placed = false;
    for (const g of groups) {
      if (g.some(o => sMin < timeToMinutes(o.end_time) && eMin > timeToMinutes(o.start_time))) {
        g.push(m); placed = true; break;
      }
    }
    if (!placed) groups.push([m]);
  }

  const result: OverlapInfo[] = [];

  for (const group of groups) {
    if (group.length === 1) {
      result.push({ meeting: group[0], leftPct: 0, widthPct: 100, zIndex: 10, isNested: false });
      continue;
    }

    const cols: MeetingData[][] = [];
    for (const m of group) {
      const sMin = timeToMinutes(m.start_time);
      const eMin = timeToMinutes(m.end_time);
      let assigned = false;
      for (const col of cols) {
        const lastEnd = timeToMinutes(col[col.length - 1].end_time);
        const fullyContained = sMin >= timeToMinutes(col[0].start_time) && eMin <= timeToMinutes(col[0].end_time);
        if (sMin >= lastEnd || fullyContained) { col.push(m); assigned = true; break; }
      }
      if (!assigned) cols.push([m]);
    }

    const totalCols = cols.length;
    const INSET_PER_LEVEL = totalCols > 1 ? Math.min(28, 70 / totalCols) : 0;

    cols.forEach((col, colIdx) => {
      col.forEach(m => {
        const leftPct = colIdx === 0 ? 0 : colIdx * INSET_PER_LEVEL;
        const widthPct = colIdx === 0
          ? (totalCols === 1 ? 100 : 100 - INSET_PER_LEVEL * 1.2)
          : 100 - leftPct - INSET_PER_LEVEL;
        result.push({ meeting: m, leftPct, widthPct, zIndex: 10 + colIdx * 5, isNested: colIdx > 0 });
      });
    });
  }

  return result;
}

// ─── Main component ────────────────────────────────────────────────────────────
export function CalendarViews(p: CalendarViewProps) {
  const { viewMode, slotHeight, totalSlots, hideOffHours, workStartMin, workEndMin,
    visibleStartHour, visibleEndHour, currentTime, currentUserId,
    getMeetings, getMeetingColor, resolveName,
    isToday, isSelected, toFarsiTime,
    isDragging, dragStartSlot, dragEndSlot, dragDate,
    dragMoveMeeting, dragMoveOriginalSlot, dragMoveOriginalEndSlot,
    dragMoveCurrentDeltaSlot, dragMoveCurrentDeltaDay, dragMovedRef,
    setDragMoveMeeting, setDragMoveStartY, setDragMoveStartX,
    setDragMoveOriginalSlot, setDragMoveOriginalEndSlot,
    setDragMoveCurrentDeltaSlot, setDragMoveCurrentDeltaDay, setDragMoveOriginalDate,
    resizeMeeting, resizeOriginalEndSlot, resizeCurrentDelta,
    setResizeMeeting, setResizeStartY, setResizeOriginalEndSlot, setResizeCurrentDelta,
    allDayDragging, allDayDragStart, allDayDragEnd,
    setAllDayDragStart, setAllDayDragEnd, setAllDayDragging,
    setAllDayFormDate, setAllDayFormEndDate, setShowAllDayForm,
    timeGridRef, timeScrollRef, weekGridRef, dayGridRef, previewRef,
    handleGridMouseDown, handleGridMouseMove, handleGridTouchStart, handleGridTouchMove,
    commitDrag, handleHourColTouchStart, handleHourColTouchMove, handleHourColTouchEnd,
    adjustSlotHeight, handleEditMeeting, handleBlockClick,
    setSelectedJy, setSelectedJm, setSelectedJd, setViewMode,
    setMonthDayPopup, onCreateMeetingForDay, previewMeeting, previewPos, setPreviewMeeting, setDetailMeeting,
    expandedMeetingId, setExpandedMeetingId,
    selectedJy, selectedJm, selectedJd, currentJy, currentJm,
    getOccasionsForDay, getAllDayEventsForDay, fetchAllDayEvents, isInAllDayDragRange,
    weekDays, mainMonthDays, listMeetings, listScrollRef,
  } = p;

  // ── Slot lines ───────────────────────────────────────────────────────────────
  const renderSlotLines = (n: number) => {
    const workStartSlot = workStartMin / 30;
    const workEndSlot = workEndMin / 30;
    return (
      <div className="absolute inset-0 pointer-events-none">
        {!hideOffHours && workStartSlot > 0 && (
          <div className="absolute left-0 right-0 bg-gray-100/60 dark:bg-gray-800/60"
            style={{ top: 0, height: `${workStartSlot * slotHeight}px` }} />
        )}
        {!hideOffHours && workEndSlot < n && (
          <div className="absolute left-0 right-0 bg-gray-100/60 dark:bg-gray-800/60"
            style={{ top: `${workEndSlot * slotHeight}px`, height: `${(n - workEndSlot) * slotHeight}px` }} />
        )}
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className={`absolute left-0 right-0 ${i % 2 === 1 ? 'border-b border-gray-300 dark:border-gray-600' : 'border-b border-gray-100 dark:border-gray-800'}`}
            style={{ top: `${(i + 1) * slotHeight}px` }} />
        ))}
      </div>
    );
  };

  // ── Current time line ────────────────────────────────────────────────────────
  const renderCurrentTimeLine = (jy: number, jm: number, jd: number, showLabel = true) => {
    if (!isToday(jy, jm, jd)) return null;
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    const top = ((nowMin - HOURS_START * 60) / 30) * slotHeight;
    const timeLabel = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
    return (
      <div className="absolute left-0 right-0 z-20 pointer-events-none" style={{ top: `${top}px` }}>
        <div className="flex items-center">
          {showLabel && (
            <span className="text-[9px] font-bold text-red-500 bg-white dark:bg-gray-900 px-0.5 leading-none flex-shrink-0 -ml-0.5 rounded-sm">{timeLabel}</span>
          )}
          <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
          <div className="flex-1 h-px bg-red-500" />
        </div>
      </div>
    );
  };

  // ── Meeting block ────────────────────────────────────────────────────────────
  const renderMeetingBlock = (
    meeting: MeetingData,
    colWidthMultiple = 1,
    leftPct = 0,
    widthPct = 100,
    blockZIndex = 10,
    isNested = false,
  ) => {
    const startMin = timeToMinutes(meeting.start_time);
    const endMin = timeToMinutes(meeting.end_time);
    if (startMin < 0 || endMin < 0) return null;
    const startSlot = minutesToSlotIndex(startMin);
    const endSlot = minutesToSlotIndex(endMin);
    const height = Math.max((endSlot - startSlot) * slotHeight, slotHeight * 0.6);
    const color = getMeetingColor(meeting);
    const isBeingDragged = dragMoveMeeting?.id === meeting.id;
    const isBeingResized = resizeMeeting?.id === meeting.id;
    const visualTop = isBeingDragged ? (dragMoveOriginalSlot + dragMoveCurrentDeltaSlot) * slotHeight : startSlot * slotHeight;
    const visualHeight = isBeingResized ? Math.max((resizeOriginalEndSlot + resizeCurrentDelta - startSlot) * slotHeight, slotHeight * 0.6) : height;
    const dispStart = isBeingDragged ? minutesToTime((dragMoveOriginalSlot + dragMoveCurrentDeltaSlot) * 30) : (meeting.start_time || '');
    const dispEnd = isBeingDragged ? minutesToTime((dragMoveOriginalEndSlot + dragMoveCurrentDeltaSlot) * 30) : (meeting.end_time || '');
    const origDateStr = parseRequestDateToDateStr(meeting.request_date) || '';
    const canMove = meeting.user_id === currentUserId || meeting.meeting_manager === currentUserId;
    const isCompact = visualHeight < 48;
    const isTiny = visualHeight < 28;

    const GUTTER = 4;
    const insetStyle: React.CSSProperties = {
      right: `calc(${leftPct}% + ${GUTTER}px)`,
      left: `calc(${100 - leftPct - widthPct}% + ${GUTTER}px)`,
    };

    const onBlockDown = (e: React.MouseEvent) => {
      e.stopPropagation(); e.preventDefault();
      if (!canMove || !origDateStr) return;
      dragMovedRef.current = false;
      setPreviewMeeting(null);
      setDragMoveMeeting(meeting); setDragMoveStartY(e.clientY); setDragMoveStartX(e.clientX);
      setDragMoveOriginalSlot(startSlot); setDragMoveOriginalEndSlot(endSlot);
      setDragMoveCurrentDeltaSlot(0); setDragMoveCurrentDeltaDay(0);
      setDragMoveOriginalDate(origDateStr);
    };
    const onBlockTouch = (e: React.TouchEvent) => {
      e.stopPropagation();
      if (!canMove || !origDateStr) return;
      e.preventDefault();
      dragMovedRef.current = false;
      setPreviewMeeting(null);
      const t = e.touches[0];
      setDragMoveMeeting(meeting); setDragMoveStartY(t.clientY); setDragMoveStartX(t.clientX);
      setDragMoveOriginalSlot(startSlot); setDragMoveOriginalEndSlot(endSlot);
      setDragMoveCurrentDeltaSlot(0); setDragMoveCurrentDeltaDay(0);
      setDragMoveOriginalDate(origDateStr);
    };
    const onResizeDown = (e: React.MouseEvent) => {
      if (!canMove) return; e.stopPropagation(); e.preventDefault();
      setResizeMeeting(meeting); setResizeStartY(e.clientY); setResizeOriginalEndSlot(endSlot); setResizeCurrentDelta(0);
    };
    const onResizeTouch = (e: React.TouchEvent) => {
      if (!canMove) return; e.stopPropagation();
      setResizeMeeting(meeting); setResizeStartY(e.touches[0].clientY); setResizeOriginalEndSlot(endSlot); setResizeCurrentDelta(0);
    };

    let ghostStyle: React.CSSProperties = {};
    if (isBeingDragged && viewMode === 'week' && dragMoveCurrentDeltaDay !== 0) {
      const dayColWidth = 100 / 7;
      ghostStyle = { transform: `translateX(${-dragMoveCurrentDeltaDay * dayColWidth * colWidthMultiple}%)` };
    }

    const participantCount = (meeting.participant_user_ids || []).length + (meeting.notify_users || []).length;

    return (
      <div key={meeting.id}
        className={`absolute rounded-lg overflow-hidden select-none touch-none group ${isNested ? 'ring-[3px] ring-white dark:ring-gray-900 shadow-[0_2px_8px_rgba(0,0,0,0.35)] border-2 border-white/80 dark:border-gray-900/80' : 'border-2 border-white/60 dark:border-gray-900/60 shadow-sm'} ${(isBeingDragged || isBeingResized) ? 'shadow-2xl opacity-90 cursor-grabbing' : canMove ? 'cursor-grab hover:shadow-xl' : 'cursor-pointer hover:shadow-xl'} transition-shadow`}
        style={{ top: `${visualTop}px`, height: `${visualHeight}px`, backgroundColor: color, zIndex: (isBeingDragged || isBeingResized) ? 30 : blockZIndex, ...insetStyle, transition: (isBeingDragged || isBeingResized) ? 'none' : 'box-shadow 0.15s', ...ghostStyle }}
        onMouseDown={onBlockDown} onTouchStart={onBlockTouch}
        onMouseUp={e => { e.stopPropagation(); if (!dragMovedRef.current) { setDragMoveMeeting(null); setDragMoveCurrentDeltaSlot(0); setDragMoveCurrentDeltaDay(0); } }}
        onClick={e => { e.stopPropagation(); handleBlockClick(meeting, e); }}
      >
        <div className="px-2 py-1 h-full flex flex-col gap-0.5 overflow-hidden">
          {!isTiny && (
            <div className={`${viewMode === 'week' ? 'hidden sm:flex' : 'flex'} items-center gap-0.5 flex-shrink-0`}>
              <Clock className="w-2.5 h-2.5 text-white/70 flex-shrink-0" />
              <span className="text-white/90 text-[10px] font-medium leading-none">{toFarsiTime(dispStart)} – {toFarsiTime(dispEnd)}</span>
            </div>
          )}
          <div className={`text-white font-semibold leading-tight ${
            viewMode === 'week'
              ? (isCompact ? 'text-[7px] sm:text-[11px]' : 'text-[7px] sm:text-xs')
              : (isCompact ? 'text-[11px]' : 'text-xs')
          } ${isTiny ? 'truncate' : viewMode === 'week' ? 'break-words sm:line-clamp-2' : 'line-clamp-2'} flex-shrink-0`}>
            {meeting.subject}
          </div>
          {!isCompact && meeting.location && (
            <div className={`${viewMode === 'week' ? 'hidden sm:flex' : 'flex'} items-center gap-0.5 flex-shrink-0`}>
              <MapPin className="w-2.5 h-2.5 text-white/60 flex-shrink-0" />
              <span className="text-white/75 text-[10px] truncate">{meeting.location}</span>
            </div>
          )}
          {!isCompact && participantCount > 0 && (
            <div className={`${viewMode === 'week' ? 'hidden sm:flex' : 'flex'} items-center gap-0.5 mt-auto flex-shrink-0`}>
              <div className="flex items-center gap-0.5 bg-white/20 rounded-full px-1.5 py-0.5">
                <svg className="w-2.5 h-2.5 text-white/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                <span className="text-[9px] text-white/90 font-medium">{participantCount}</span>
              </div>
            </div>
          )}
          {canMove && !isTiny && (
            <button onClick={e => { e.stopPropagation(); handleEditMeeting(meeting); }} onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}
              className="absolute top-1 left-1 p-0.5 text-white/50 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded">
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          )}
        </div>
        {canMove && (
          <div className={`absolute bottom-0 left-0 right-0 h-2.5 cursor-ns-resize touch-none flex items-center justify-center ${isBeingResized ? 'bg-black/20' : 'opacity-0 group-hover:opacity-100 hover:bg-black/20 transition-opacity'}`}
            onMouseDown={onResizeDown} onTouchStart={onResizeTouch}>
            <div className="w-6 h-0.5 rounded-full bg-white/60" />
          </div>
        )}
      </div>
    );
  };

  const renderMeetingsWithOverlap = (mts: MeetingData[], colWidthMultiple = 1) => {
    const assigned = computeOverlapLayers(mts);
    const withTimeIds = new Set(assigned.map(a => a.meeting.id));
    const noTime = mts.filter(m => !withTimeIds.has(m.id));
    return [
      ...assigned.map(({ meeting, leftPct, widthPct, zIndex, isNested }) =>
        renderMeetingBlock(meeting, colWidthMultiple, leftPct, widthPct, zIndex, isNested)
      ),
      ...noTime.map(m => renderMeetingBlock(m, colWidthMultiple)),
    ];
  };

  // ── Preview popup ────────────────────────────────────────────────────────────
  const renderPreviewPopup = () => {
    if (!previewMeeting) return null;
    const m = previewMeeting;
    const color = getMeetingColor(m);
    const participantIds = m.participant_user_ids || [];
    const notifyIds = (m.notify_users || []) as string[];
    const getNameById = (id: string) => resolveName(id);
    const isMobile = window.innerWidth < 640;
    const popupStyle: React.CSSProperties = isMobile
      ? { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
      : {
          position: 'absolute',
          top: Math.min(previewPos.y, window.innerHeight - 420),
          right: window.innerWidth - previewPos.x < 300 ? window.innerWidth - previewPos.x + 8 : undefined,
          left: window.innerWidth - previewPos.x >= 300 ? previewPos.x + 8 : undefined,
        };
    return (
      <div className="fixed inset-0 z-[60] pointer-events-none" dir="rtl">
        {isMobile && <div className="absolute inset-0 bg-black/30 pointer-events-auto" onClick={() => setPreviewMeeting(null)} />}
        <div ref={previewRef}
          className="pointer-events-auto bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 w-72 max-h-[90vh] overflow-y-auto"
          style={popupStyle}
          onClick={e => e.stopPropagation()}
        >
          <div className="h-2 rounded-t-2xl w-full" style={{ backgroundColor: color }} />
          <div className="p-4">
            <div className="flex items-start justify-between gap-2 mb-3">
              <h3 className="font-bold text-gray-900 dark:text-white text-sm leading-tight">{m.subject}</h3>
              <button onClick={() => setPreviewMeeting(null)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0 -mt-0.5">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              {m.start_time && m.end_time && (
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span className="font-medium">{toFarsiTime(m.start_time)} – {toFarsiTime(m.end_time)}</span>
                </div>
              )}
              {m.location && (
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <MapPin className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  <span>{m.location}</span>
                </div>
              )}
              {m.representative && (
                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
                  <span>{m.representative}</span>
                </div>
              )}
              {participantIds.length > 0 && (
                <div className="pt-1">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">شرکت‌کنندگان</p>
                  <div className="flex flex-wrap gap-1">
                    {participantIds.map(id => (
                      <span key={id} className="text-[11px] px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full">{getNameById(id)}</span>
                    ))}
                  </div>
                </div>
              )}
              {notifyIds.length > 0 && (
                <div className="pt-1">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">مطلعین</p>
                  <div className="flex flex-wrap gap-1">
                    {notifyIds.slice(0, 6).map(id => (
                      <span key={id} className="text-[11px] px-2 py-0.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full">{getNameById(id)}</span>
                    ))}
                  </div>
                </div>
              )}
              {m.notes && (
                <div className="p-2.5 bg-gray-50 dark:bg-gray-700/50 rounded-xl text-xs text-gray-500 dark:text-gray-400 leading-relaxed mt-1">{m.notes}</div>
              )}
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => { setPreviewMeeting(null); setDetailMeeting(m); }}
                className="flex-1 py-2 text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                جزئیات بیشتر
              </button>
              {(m.user_id === currentUserId || m.meeting_manager === currentUserId) && (
                <button onClick={() => { setPreviewMeeting(null); handleEditMeeting(m); }}
                  className="flex-1 py-2 text-xs font-semibold text-white rounded-xl transition-colors hover:opacity-90"
                  style={{ backgroundColor: color }}>
                  ویرایش
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Hour column ──────────────────────────────────────────────────────────────
  const renderHourColumn = () => (
    <div className="flex-shrink-0 w-14"
      onWheel={e => { if (e.ctrlKey || e.altKey) { e.preventDefault(); adjustSlotHeight(e.deltaY < 0 ? 4 : -4); } }}
      onTouchStart={handleHourColTouchStart}
      onTouchMove={handleHourColTouchMove}
      onTouchEnd={handleHourColTouchEnd}>
      {Array.from({ length: HOURS_END - HOURS_START }, (_, i) => i + HOURS_START).map(h => (
        <div key={h} style={{ height: `${slotHeight * 2}px` }} className="relative">
          {h > 0 && <span className="absolute -top-2.5 right-1 text-[10px] text-gray-400 dark:text-gray-500">{String(h).padStart(2, '0')}:00</span>}
        </div>
      ))}
    </div>
  );

  const offHoursWrapStyle = hideOffHours ? {
    overflow: 'hidden',
    height: `${(visibleEndHour - visibleStartHour) * slotHeight * 2}px`,
  } : undefined;
  const offHoursInnerStyle = hideOffHours ? { marginTop: `-${visibleStartHour * slotHeight * 2}px` } : undefined;

  // ── Day view ─────────────────────────────────────────────────────────────────
  const renderDayView = () => {
    const dayOcc = getOccasionsForDay(selectedJy, selectedJm, selectedJd);
    const dayIsHoliday = dayOcc.some((o: any) => o.is_holiday);
    const weekdayIdx = jsDayToWeekday(jalaaliToDate(selectedJy, selectedJm, selectedJd).getDay());
    return (
      <div className="flex flex-col flex-1 overflow-hidden mx-3 mb-3 mt-1 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 shadow-sm">
        <div className="border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex">
            <div className="w-14 flex-shrink-0" />
            <div className="flex-1 text-center py-2">
              <div className={`text-sm font-medium ${(weekdayIdx === 6 || dayIsHoliday) ? 'text-red-500' : 'text-gray-500 dark:text-gray-400'}`}>
                {JALAALI_WEEKDAYS[weekdayIdx]}
              </div>
              <div className={`text-3xl font-semibold mt-0.5 w-12 h-12 inline-flex items-center justify-center rounded-full ${isToday(selectedJy, selectedJm, selectedJd) ? 'bg-blue-500 text-white' : 'dark:text-white'}`}>
                {selectedJd}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/50 px-2 py-1.5 flex-wrap min-h-[32px]">
            <span className="text-[9px] text-gray-400 w-14 flex-shrink-0 pt-0.5 text-center leading-tight">کل<br/>روز</span>
            <div className="flex flex-wrap gap-1 flex-1">
              {dayOcc.map((o: any) => (
                <span key={o.id} className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${o.is_holiday ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : o.is_celebration ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{o.title}</span>
              ))}
              {getAllDayEventsForDay(selectedJy, selectedJm, selectedJd).map((ev: any) => (
                <span key={ev.id} className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1 ${ev.type === 'leave' ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' : ev.type === 'meeting' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                  {ev.title}
                  <button type="button" onClick={async () => { await supabase.from('all_day_events').delete().eq('id', ev.id); fetchAllDayEvents(); }} className="hover:opacity-70 ml-0.5"><X className="w-2.5 h-2.5" /></button>
                </span>
              ))}
              <button type="button" onClick={() => { setAllDayFormDate({ jy: selectedJy, jm: selectedJm, jd: selectedJd }); setShowAllDayForm(true); }}
                className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-white dark:bg-gray-700 border border-dashed border-gray-300 dark:border-gray-500 text-gray-400 hover:text-blue-500 hover:border-blue-400 transition-colors flex items-center gap-0.5">
                <Plus className="w-2.5 h-2.5" />افزودن
              </button>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto" ref={el => { (timeGridRef as any).current = el; (timeScrollRef as any).current = el; }}>
          <div style={offHoursWrapStyle}>
            <div className="flex" ref={dayGridRef} style={offHoursInnerStyle}>
              {renderHourColumn()}
              <div className="flex-1 relative select-none touch-none border-r border-gray-100 dark:border-gray-700"
                ref={timeGridRef}
                onMouseDown={e => handleGridMouseDown(e, selectedJy, selectedJm, selectedJd)}
                onMouseMove={handleGridMouseMove} onMouseUp={commitDrag}
                onMouseLeave={() => { if (isDragging && !dragMoveMeeting) commitDrag(); }}
                onTouchStart={e => { if (e.touches.length === 2) { handleHourColTouchStart(e); } else { handleGridTouchStart(e, selectedJy, selectedJm, selectedJd); } }}
                onTouchMove={e => { if (e.touches.length === 2) { handleHourColTouchMove(e); } else { handleGridTouchMove(e); } }}
                onTouchEnd={() => { handleHourColTouchEnd(); commitDrag(); }}
              >
                {renderSlotLines(totalSlots)}
                {renderCurrentTimeLine(selectedJy, selectedJm, selectedJd)}
                {renderMeetingsWithOverlap(getMeetings(selectedJy, selectedJm, selectedJd), 1)}
                {isDragging && dragStartSlot !== null && dragEndSlot !== null && dragDate && dragDate.jy === selectedJy && dragDate.jm === selectedJm && dragDate.jd === selectedJd && (() => {
                  const s = Math.min(dragStartSlot, dragEndSlot); const e = Math.max(dragStartSlot, dragEndSlot) + 1;
                  return <div className="absolute left-1 right-1 bg-blue-500/20 border border-blue-500 rounded pointer-events-none z-5" style={{ top: `${s * slotHeight}px`, height: `${(e - s) * slotHeight}px` }}>
                    <div className="text-xs text-blue-700 dark:text-blue-300 font-medium px-2 py-0.5">{minutesToTime(s * 30)} - {minutesToTime(e * 30)}</div>
                  </div>;
                })()}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ── Week view ─────────────────────────────────────────────────────────────────
  const renderWeekView = () => (
    <div className="flex flex-col flex-1 overflow-hidden mx-3 mb-3 mt-1 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 shadow-sm">
      <div className="border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="grid grid-cols-[56px_repeat(7,1fr)]">
          <div />
          {weekDays.map(d => {
            const hasHol = getOccasionsForDay(d.jy, d.jm, d.jd).some((o: any) => o.is_holiday);
            return (
              <div key={d.weekday} className={`text-center py-1.5 sm:py-2 border-r border-gray-100 dark:border-gray-700 ${(d.weekday === 6 || hasHol) ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                <div className="text-[10px] sm:text-xs font-medium">{JALAALI_WEEKDAYS[d.weekday]}</div>
                <div className={`text-base sm:text-xl font-semibold mt-0.5 w-7 h-7 sm:w-9 sm:h-9 inline-flex items-center justify-center rounded-full ${isToday(d.jy, d.jm, d.jd) ? 'bg-blue-500 text-white' : 'dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer'}`}
                  onClick={() => { setSelectedJy(d.jy); setSelectedJm(d.jm); setSelectedJd(d.jd); setViewMode('day'); }}>
                  {d.jd}
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-[56px_repeat(7,1fr)] border-t border-gray-100 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/50">
          <div className="flex items-center justify-center">
            <span className="text-[9px] text-gray-400 leading-tight text-center px-1">کل<br/>روز</span>
          </div>
          {weekDays.map(d => {
            const occ = getOccasionsForDay(d.jy, d.jm, d.jd);
            const dayEvs = getAllDayEventsForDay(d.jy, d.jm, d.jd);
            const isDragHighlight = isInAllDayDragRange(d.jy, d.jm, d.jd);
            return (
              <div key={d.weekday}
                className={`border-r border-gray-100 dark:border-gray-700 px-0.5 py-0.5 min-h-[22px] space-y-0.5 group/allday select-none cursor-pointer transition-colors ${isDragHighlight ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                onMouseDown={e => { e.preventDefault(); setAllDayDragStart({ jy: d.jy, jm: d.jm, jd: d.jd }); setAllDayDragEnd({ jy: d.jy, jm: d.jm, jd: d.jd }); setAllDayDragging(true); }}
                onMouseEnter={() => { if (allDayDragging) setAllDayDragEnd({ jy: d.jy, jm: d.jm, jd: d.jd }); }}
                onMouseUp={() => {
                  if (allDayDragging && allDayDragStart) {
                    const end = allDayDragEnd || allDayDragStart;
                    setAllDayFormDate(allDayDragStart);
                    setAllDayFormEndDate(end);
                    setShowAllDayForm(true);
                    setAllDayDragging(false);
                    setAllDayDragStart(null);
                    setAllDayDragEnd(null);
                  }
                }}
              >
                {occ.map((o: any) => (
                  <div key={o.id} title={o.title} className={`text-[9px] px-1 py-0.5 rounded truncate font-medium leading-tight ${o.is_holiday ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : o.is_celebration ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{o.title}</div>
                ))}
                {dayEvs.map((ev: any) => (
                  <div key={ev.id} className={`text-[9px] px-1 py-0.5 rounded truncate font-medium leading-tight flex items-center gap-0.5 ${ev.type === 'leave' ? 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' : ev.type === 'meeting' ? 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                    <span className="truncate">{ev.title}</span>
                    <button type="button" onClick={async e => { e.stopPropagation(); await supabase.from('all_day_events').delete().eq('id', ev.id); fetchAllDayEvents(); }} className="hover:opacity-70 flex-shrink-0"><X className="w-2 h-2" /></button>
                  </div>
                ))}
                {!isDragHighlight && (
                  <div className="w-full text-[9px] text-gray-300 opacity-0 group-hover/allday:opacity-100 transition-opacity text-center leading-tight py-0.5">+</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto" ref={el => { (timeGridRef as any).current = el; (timeScrollRef as any).current = el; }}>
        <div style={offHoursWrapStyle}>
          <div className="grid grid-cols-[56px_repeat(7,1fr)] relative" ref={weekGridRef} style={offHoursInnerStyle}>
            {(() => {
              if (!weekDays.some(d => isToday(d.jy, d.jm, d.jd))) return null;
              const todayIdx = weekDays.findIndex(d => isToday(d.jy, d.jm, d.jd));
              const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
              const top = ((nowMin - HOURS_START * 60) / 30) * slotHeight;
              const timeLabel = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
              const colRight = `calc(56px + ${todayIdx} * (100% - 56px) / 7)`;
              const colWidth = `calc((100% - 56px) / 7)`;
              return (
                <div className="absolute z-30 pointer-events-none" style={{ top: `${top}px`, left: 0, right: 0 }}>
                  <div className="absolute h-px bg-red-300/40 dark:bg-red-700/30" style={{ left: 0, right: '56px' }} />
                  <div className="absolute h-px bg-red-500" style={{ right: colRight, width: colWidth }} />
                  <div className="absolute w-2 h-2 rounded-full bg-red-500 -translate-y-[3px]"
                    style={{ right: `calc(56px + ${todayIdx + 1} * (100% - 56px) / 7 - 4px)` }} />
                  <div className="absolute right-0 -translate-y-2" style={{ width: '56px' }}>
                    <span className="text-[9px] font-bold text-red-500 block text-center leading-none">{timeLabel}</span>
                  </div>
                </div>
              );
            })()}
            <div onWheel={e => { if (e.ctrlKey || e.altKey) { e.preventDefault(); adjustSlotHeight(e.deltaY < 0 ? 4 : -4); } }}
              onTouchStart={handleHourColTouchStart}
              onTouchMove={handleHourColTouchMove}
              onTouchEnd={handleHourColTouchEnd}>
              {Array.from({ length: HOURS_END - HOURS_START }, (_, i) => i + HOURS_START).map(h => (
                <div key={h} style={{ height: `${slotHeight * 2}px` }} className="relative">
                  {h > 0 && <span className="absolute -top-2.5 right-1 text-[10px] text-gray-400">{String(h).padStart(2, '0')}:00</span>}
                </div>
              ))}
            </div>
            {weekDays.map((d, colIdx) => {
              const dm = getMeetings(d.jy, d.jm, d.jd);
              return (
                <div key={d.weekday} className={`relative border-r border-gray-100 dark:border-gray-700 select-none touch-none ${isToday(d.jy, d.jm, d.jd) ? 'bg-blue-50/30 dark:bg-blue-900/5' : ''}`}
                  onMouseDown={e => handleGridMouseDown(e, d.jy, d.jm, d.jd)} onMouseMove={handleGridMouseMove} onMouseUp={commitDrag}
                  onMouseLeave={() => { if (isDragging && !dragMoveMeeting) commitDrag(); }}
                  onTouchStart={e => { if (e.touches.length === 2) { handleHourColTouchStart(e); } else { handleGridTouchStart(e, d.jy, d.jm, d.jd); } }}
                  onTouchMove={e => { if (e.touches.length === 2) { handleHourColTouchMove(e); } else { handleGridTouchMove(e); } }}
                  onTouchEnd={() => { handleHourColTouchEnd(); commitDrag(); }}
                >
                  {renderSlotLines(totalSlots)}
                  {renderMeetingsWithOverlap(dm.filter(m => {
                    if (dragMoveMeeting?.id === m.id) {
                      const origDateStr2 = parseRequestDateToDateStr(m.request_date) || '';
                      const origColIdx = weekDays.findIndex(wd => jalaaliToYYYYMMDD(wd.jy, wd.jm, wd.jd) === origDateStr2);
                      const isOrigCol = origColIdx === colIdx;
                      const isTargetCol = Math.max(0, Math.min(6, origColIdx + dragMoveCurrentDeltaDay)) === colIdx;
                      if (!isOrigCol && !isTargetCol) return false;
                    }
                    return true;
                  }), 7)}
                  {isDragging && dragStartSlot !== null && dragEndSlot !== null && dragDate && dragDate.jy === d.jy && dragDate.jm === d.jm && dragDate.jd === d.jd && (() => {
                    const s = Math.min(dragStartSlot, dragEndSlot); const e = Math.max(dragStartSlot, dragEndSlot) + 1;
                    return <div className="absolute left-0.5 right-0.5 bg-blue-500/20 border border-blue-500 rounded z-5 pointer-events-none" style={{ top: `${s * slotHeight}px`, height: `${(e - s) * slotHeight}px` }} />;
                  })()}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Month view ───────────────────────────────────────────────────────────────
  const renderMonthView = () => (
    <div className="flex flex-col flex-1 overflow-hidden mx-3 mb-3 mt-1 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 shadow-sm">
      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        {JALAALI_WEEKDAYS.map((d, i) => (
          <div key={d} className={`text-center text-[10px] sm:text-xs font-medium py-1.5 sm:py-2 ${i === 6 ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>{d}</div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-900">
        <div className="grid grid-cols-7">
          {mainMonthDays.map((day, idx) => {
            if (day === null) return <div key={`e${idx}`} className="min-h-[60px] sm:min-h-[90px] bg-gray-50/50 dark:bg-gray-800/50 border-b border-r border-gray-100 dark:border-gray-700" />;
            const dm = getMeetings(currentJy, currentJm, day);
            const isTd = isToday(currentJy, currentJm, day);
            const isSel = isSelected(currentJy, currentJm, day);
            const isFri = idx % 7 === 6;
            const dayOcc = getOccasionsForDay(currentJy, currentJm, day);
            const hasHoliday = dayOcc.some((o: any) => o.is_holiday);
            return (
              <div key={day}
                onClick={e => {
                  setSelectedJy(currentJy); setSelectedJm(currentJm); setSelectedJd(day);
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setMonthDayPopup({ jy: currentJy, jm: currentJm, jd: day, x: rect.left, y: rect.bottom });
                }}
                className={`min-h-[60px] sm:min-h-[90px] p-0.5 sm:p-1 border-b border-r border-gray-100 dark:border-gray-700 cursor-pointer transition-colors hover:bg-blue-50/40 dark:hover:bg-blue-900/10 ${isSel ? 'bg-blue-50 dark:bg-blue-900/20' : hasHoliday ? 'bg-red-50/40 dark:bg-red-900/10' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-[10px] sm:text-xs font-medium w-5 h-5 sm:w-6 sm:h-6 inline-flex items-center justify-center rounded-full ${isTd ? 'bg-blue-500 text-white' : (isFri || hasHoliday) ? 'text-red-500 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>{day}</span>
                  {onCreateMeetingForDay && (
                    <button type="button" title="تنظیم جلسه" aria-label="تنظیم جلسه برای این روز"
                      onClick={e => { e.stopPropagation(); onCreateMeetingForDay(currentJy, currentJm, day); }}
                      className="p-1 rounded-md text-gray-300 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                      <CalendarPlus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {dayOcc.length > 0 && (
                  <div className="space-y-0.5 mt-0.5">
                    {dayOcc.slice(0, 1).map((o: any) => (
                      <div key={o.id} title={o.title} className={`text-[8px] sm:text-[9px] px-0.5 sm:px-1 py-0.5 rounded truncate font-medium leading-tight ${o.is_holiday ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : o.is_celebration ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>{o.title}</div>
                    ))}
                  </div>
                )}
                <div className="space-y-0.5 mt-0.5">
                  {dm.slice(0, 2).map(m => {
                    const c = getMeetingColor(m);
                    return (
                      <div key={m.id} className="text-[7px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded text-white truncate font-medium" style={{ backgroundColor: c }}>
                        <span className="hidden sm:inline">{m.start_time ? toFarsiTime(m.start_time) + ' ' : ''}</span>
                        {m.subject}
                      </div>
                    );
                  })}
                  {dm.length > 2 && <div className="text-[9px] sm:text-[10px] text-blue-500 dark:text-blue-400 px-0.5 sm:px-1 font-medium">+{dm.length - 2}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  // ── List view ─────────────────────────────────────────────────────────────────
  const renderListView = () => (
    <div ref={listScrollRef} className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 p-4 mx-3 mb-3 mt-1 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm">
      {listMeetings.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" /><p>جلسه‌ای وجود ندارد</p></div>
      ) : listMeetings.map(group => (
        <div key={group.date} {...(isToday(group.jy, group.jm, group.jd) ? { 'data-today': 'true' } : {})} className="mb-4">
          <div className="flex items-center gap-3 mb-2 sticky top-0 bg-gray-50 dark:bg-gray-900 py-1 z-10">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0 ${isToday(group.jy, group.jm, group.jd) ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-white border border-gray-200 dark:border-gray-600'}`}>{group.jd}</div>
            <div>
              <p className="text-sm font-semibold dark:text-white">{JALAALI_WEEKDAYS[jsDayToWeekday(jalaaliToDate(group.jy, group.jm, group.jd).getDay())]}</p>
              <p className="text-xs text-gray-400">{JALAALI_MONTHS[group.jm - 1]} {group.jy}</p>
            </div>
          </div>
          <div className="space-y-2">
            {group.meetings.map(m => {
              const c = getMeetingColor(m);
              const isExp = expandedMeetingId === m.id;
              const canEditM = m.user_id === currentUserId || m.meeting_manager === currentUserId;
              const participantIds = m.participant_user_ids || [];
              const notifyIds = (m.notify_users || []) as string[];
              const externalList = m.external_participants || [];
              const getNameById = (id: string) => resolveName(id);
              return (
                <div key={m.id} className="bg-white dark:bg-gray-800 rounded-2xl overflow-hidden border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
                  <button className="w-full text-right px-4 py-3.5 flex items-center gap-3" onClick={() => setExpandedMeetingId(isExp ? null : m.id)}>
                    <div className="w-1.5 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm dark:text-white truncate">{m.subject}</p>
                      <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {m.start_time && m.end_time && (
                          <span className="flex items-center gap-1 font-medium text-gray-700 dark:text-gray-300">
                            <Clock className="w-3 h-3 text-gray-400" />{toFarsiTime(m.start_time)} – {toFarsiTime(m.end_time)}
                          </span>
                        )}
                        {m.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{m.location}</span>}
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 text-gray-300 flex-shrink-0 transition-transform duration-200 ${isExp ? '-rotate-90' : ''}`} />
                  </button>
                  {isExp && (
                    <div className="border-t border-gray-100 dark:border-gray-700">
                      <div className="px-5 py-4 space-y-4">
                        {m.representative && (
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>
                            </div>
                            <div>
                              <p className="text-[11px] text-gray-400 font-medium mb-0.5">نماینده</p>
                              <p className="text-sm font-medium dark:text-white">{m.representative}</p>
                              {m.phone && <a href={`tel:${m.phone}`} className="text-xs text-blue-500 mt-0.5 block">{m.phone}</a>}
                            </div>
                          </div>
                        )}
                        {participantIds.length > 0 && (
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                              <Users className="w-4 h-4 text-blue-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-gray-400 font-medium mb-1.5">شرکت‌کنندگان ({participantIds.length})</p>
                              <div className="flex flex-wrap gap-1.5">
                                {participantIds.map(id => <span key={id} className="text-xs px-2.5 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full font-medium">{getNameById(id)}</span>)}
                              </div>
                            </div>
                          </div>
                        )}
                        {notifyIds.length > 0 && (
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-gray-400 font-medium mb-1.5">مطلعین ({notifyIds.length})</p>
                              <div className="flex flex-wrap gap-1.5">
                                {notifyIds.slice(0, 8).map(id => <span key={id} className="text-xs px-2.5 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-full font-medium">{getNameById(id)}</span>)}
                              </div>
                            </div>
                          </div>
                        )}
                        {externalList.length > 0 && (
                          <div className="flex items-start gap-3">
                            <div className="w-8 h-8 rounded-lg bg-green-50 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-gray-400 font-medium mb-1.5">خارج سازمان ({externalList.length})</p>
                              <div className="flex flex-wrap gap-1.5">
                                {externalList.map((n: string) => <span key={n} className="text-xs px-2.5 py-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full font-medium">{n}</span>)}
                              </div>
                            </div>
                          </div>
                        )}
                        {m.notes && (
                          <div className="p-3 bg-gray-50 dark:bg-gray-700/40 rounded-xl text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{m.notes}</div>
                        )}
                        {canEditM && (
                          <button onClick={() => handleEditMeeting(m)}
                            className="w-full py-2.5 text-sm font-semibold rounded-xl transition-colors text-white"
                            style={{ backgroundColor: c }}>
                            ویرایش جلسه
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <>
      {renderPreviewPopup()}
      {viewMode === 'day' && renderDayView()}
      {viewMode === 'week' && renderWeekView()}
      {viewMode === 'month' && renderMonthView()}
      {(viewMode === 'list-week' || viewMode === 'list-month') && renderListView()}
    </>
  );
}
