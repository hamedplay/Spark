import React from 'react';
import { Clock, MapPin, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { MeetingData } from './types';
import {
  HOURS_START, HOURS_END,
  parseRequestDateToDateStr, jalaaliToDate, jsDayToWeekday,
  jalaaliToYYYYMMDD, minutesToTime, timeToMinutes, minutesToSlotIndex,
} from './utils';

// ─── Props interface (shared by all views) ──────────────────────────────────
export interface CalendarViewProps {
  viewMode: 'month' | 'week' | 'day' | 'list-week' | 'list-month';
  selectedJy: number; selectedJm: number; selectedJd: number;
  currentJy: number; currentJm: number;
  currentTime: Date;
  currentUserId: string | null;
  getMeetings: (jy: number, jm: number, jd: number) => MeetingData[];
  getMeetingColor: (m: MeetingData) => string;
  resolveName: (uid: string) => string;
  weekDays: Array<{ jy: number; jm: number; jd: number; weekday: number }>;
  mainMonthDays: Array<number | null>;
  listMeetings: Array<{ date: string; jy: number; jm: number; jd: number; meetings: MeetingData[] }>;
  getOccasionsForDay: (jy: number, jm: number, jd: number) => any[];
  getAllDayEventsForDay: (jy: number, jm: number, jd: number) => any[];
  fetchAllDayEvents: () => void;
  isInAllDayDragRange: (jy: number, jm: number, jd: number) => boolean;
  slotHeight: number;
  totalSlots: number;
  hideOffHours: boolean;
  visibleStartHour: number;
  visibleEndHour: number;
  workStartMin: number;
  workEndMin: number;
  isToday: (jy: number, jm: number, jd: number) => boolean;
  isSelected: (jy: number, jm: number, jd: number) => boolean;
  toFarsiTime: (t: string) => string;
  isDragging: boolean;
  dragStartSlot: number | null;
  dragEndSlot: number | null;
  dragDate: { jy: number; jm: number; jd: number } | null;
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
  resizeMeeting: MeetingData | null;
  resizeOriginalEndSlot: number;
  resizeCurrentDelta: number;
  setResizeMeeting: (m: MeetingData | null) => void;
  setResizeStartY: (v: number) => void;
  setResizeOriginalEndSlot: (v: number) => void;
  setResizeCurrentDelta: (v: number) => void;
  allDayDragging: boolean;
  allDayDragStart: { jy: number; jm: number; jd: number } | null;
  allDayDragEnd: { jy: number; jm: number; jd: number } | null;
  setAllDayDragStart: (v: { jy: number; jm: number; jd: number } | null) => void;
  setAllDayDragEnd: (v: { jy: number; jm: number; jd: number } | null) => void;
  setAllDayDragging: (v: boolean) => void;
  setAllDayFormDate: (v: { jy: number; jm: number; jd: number } | null) => void;
  setAllDayFormEndDate: (v: { jy: number; jm: number; jd: number } | null) => void;
  setShowAllDayForm: (v: boolean) => void;
  timeGridRef: React.MutableRefObject<HTMLDivElement | null>;
  timeScrollRef: React.MutableRefObject<HTMLDivElement | null>;
  weekGridRef: React.MutableRefObject<HTMLDivElement | null>;
  dayGridRef: React.MutableRefObject<HTMLDivElement | null>;
  previewRef: React.MutableRefObject<HTMLDivElement | null>;
  handleGridMouseDown: (e: React.MouseEvent, jy: number, jm: number, jd: number) => void;
  handleGridMouseMove: (e: React.MouseEvent) => void;
  handleGridTouchStart: (e: React.TouchEvent, jy: number, jm: number, jd: number) => void;
  handleGridTouchMove: (e: React.TouchEvent) => void;
  commitDrag: () => void;
  handleHourColTouchStart: (e: React.TouchEvent) => void;
  handleHourColTouchMove: (e: React.TouchEvent) => void;
  handleHourColTouchEnd: () => void;
  adjustSlotHeight: (delta: number) => void;
  handleEditMeeting: (m: MeetingData) => void;
  handleBlockClick: (m: MeetingData, e: React.MouseEvent) => void;
  setSelectedJy: (v: number) => void;
  setSelectedJm: (v: number) => void;
  setSelectedJd: (v: number) => void;
  setViewMode: (v: string) => void;
  setMonthDayPopup: (v: any) => void;
  onCreateMeetingForDay?: (jy: number, jm: number, jd: number) => void;
  previewMeeting: MeetingData | null;
  previewPos: { x: number; y: number };
  setPreviewMeeting: (m: MeetingData | null) => void;
  setDetailMeeting: (m: MeetingData | null) => void;
  expandedMeetingId: string | null;
  setExpandedMeetingId: (v: string | null) => void;
  listScrollRef?: React.MutableRefObject<HTMLDivElement | null>;
}

// ─── Overlap computation ────────────────────────────────────────────────────
export interface OverlapInfo {
  meeting: MeetingData;
  leftPct: number;
  widthPct: number;
  zIndex: number;
  isNested: boolean;
}

export function computeOverlapLayers(mts: MeetingData[]): OverlapInfo[] {
  const withTime = mts.filter(m => m.start_time && m.end_time);
  if (withTime.length === 0) return [];

  const sorted = [...withTime].sort((a, b) => {
    const durA = timeToMinutes(b.end_time) - timeToMinutes(a.start_time);
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

// ─── Meeting block ──────────────────────────────────────────────────────────
export function MeetingBlock(props: {
  p: CalendarViewProps;
  meeting: MeetingData;
  colWidthMultiple?: number;
  leftPct?: number;
  widthPct?: number;
  blockZIndex?: number;
  isNested?: boolean;
}) {
  const { p, meeting } = props;
  const colWidthMultiple = props.colWidthMultiple ?? 1;
  const leftPct = props.leftPct ?? 0;
  const widthPct = props.widthPct ?? 100;
  const blockZIndex = props.blockZIndex ?? 10;
  const isNested = props.isNested ?? false;

  const { slotHeight, viewMode, currentUserId, toFarsiTime, getMeetingColor,
    dragMoveMeeting, resizeMeeting, dragMoveOriginalSlot, dragMoveOriginalEndSlot,
    dragMoveCurrentDeltaSlot, dragMoveCurrentDeltaDay, dragMovedRef,
    setPreviewMeeting, setDragMoveMeeting, setDragMoveStartY, setDragMoveStartX,
    setDragMoveOriginalSlot, setDragMoveOriginalEndSlot,
    setDragMoveCurrentDeltaSlot, setDragMoveCurrentDeltaDay, setDragMoveOriginalDate,
    setResizeMeeting, setResizeStartY, setResizeOriginalEndSlot, setResizeCurrentDelta,
    handleBlockClick, handleEditMeeting } = p;

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
}

export function renderMeetingsWithOverlap(p: CalendarViewProps, mts: MeetingData[], colWidthMultiple = 1) {
  const assigned = computeOverlapLayers(mts);
  const withTimeIds = new Set(assigned.map(a => a.meeting.id));
  const noTime = mts.filter(m => !withTimeIds.has(m.id));
  return [
    ...assigned.map(({ meeting, leftPct, widthPct, zIndex, isNested }) =>
      <MeetingBlock key={meeting.id} p={p} meeting={meeting} colWidthMultiple={colWidthMultiple} leftPct={leftPct} widthPct={widthPct} blockZIndex={zIndex} isNested={isNested} />
    ),
    ...noTime.map(m => <MeetingBlock key={m.id} p={p} meeting={m} colWidthMultiple={colWidthMultiple} />),
  ];
}

// ─── Slot lines ─────────────────────────────────────────────────────────────
export function SlotLines(props: { n: number; slotHeight: number; workStartMin: number; workEndMin: number; hideOffHours: boolean }) {
  const { n, slotHeight, workStartMin, workEndMin, hideOffHours } = props;
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
}

// ─── Current time line ──────────────────────────────────────────────────────
export function CurrentTimeLine(props: { jy: number; jm: number; jd: number; currentTime: Date; slotHeight: number; isToday: (jy: number, jm: number, jd: number) => boolean; showLabel?: boolean }) {
  const { jy, jm, jd, currentTime, slotHeight, isToday, showLabel = true } = props;
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
}

// ─── Hour column ────────────────────────────────────────────────────────────
export function HourColumn(props: { slotHeight: number; adjustSlotHeight: (delta: number) => void; handleHourColTouchStart: (e: React.TouchEvent) => void; handleHourColTouchMove: (e: React.TouchEvent) => void; handleHourColTouchEnd: () => void }) {
  const { slotHeight, adjustSlotHeight, handleHourColTouchStart, handleHourColTouchMove, handleHourColTouchEnd } = props;
  return (
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
}

// ─── Preview popup ──────────────────────────────────────────────────────────
export function PreviewPopup(props: { p: CalendarViewProps }) {
  const { p } = props;
  const { previewMeeting, previewPos, setPreviewMeeting, setDetailMeeting, getMeetingColor, resolveName, toFarsiTime, currentUserId, handleEditMeeting, previewRef } = p;
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
}
