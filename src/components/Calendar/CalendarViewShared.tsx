import React from 'react';
import { Clock, MapPin, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { MeetingData } from './types';
import {
  HOURS_START, HOURS_END,
  parseRequestDateToDateStr, jalaaliToDate, jsDayToWeekday,
  timeToMinutes, minutesToSlotIndex,
} from './utils';
import { CalendarViewProps, OverlapInfo } from './CalendarViewTypes';

const MEETING_TOUCH_LONG_PRESS_MS = 500;
const MEETING_TOUCH_MOVE_CANCEL_PX = 12;
const MEETING_DOUBLE_TAP_MS = 320;
type MeetingTouchHoldState = {
  timer: number;
  startX: number;
  startY: number;
  activated: boolean;
};
const meetingTouchHoldStates = new Map<string, MeetingTouchHoldState>();
const meetingResizeTouchHoldStates = new Map<string, MeetingTouchHoldState>();
const meetingTouchSuppressClickUntil = new Map<string, number>();
const meetingTouchLastTapAt = new Map<string, number>();
const meetingTouchSingleTapTimers = new Map<string, number>();

function clearMeetingTouchHold(meetingId: string) {
  const state = meetingTouchHoldStates.get(meetingId);
  if (state) window.clearTimeout(state.timer);
  meetingTouchHoldStates.delete(meetingId);
}

function clearMeetingResizeTouchHold(meetingId: string) {
  const state = meetingResizeTouchHoldStates.get(meetingId);
  if (state) window.clearTimeout(state.timer);
  meetingResizeTouchHoldStates.delete(meetingId);
}

export function computeOverlapLayers(mts: MeetingData[]): OverlapInfo[] {
  const withTime = mts
    .filter(m => m.start_time && m.end_time)
    .sort((a, b) => {
      const startDiff = timeToMinutes(a.start_time) - timeToMinutes(b.start_time);
      if (startDiff !== 0) return startDiff;
      return timeToMinutes(b.end_time) - timeToMinutes(a.end_time);
    });

  if (withTime.length === 0) return [];

  const overlaps = (a: MeetingData, b: MeetingData) => {
    const aStart = timeToMinutes(a.start_time);
    const aEnd = timeToMinutes(a.end_time);
    const bStart = timeToMinutes(b.start_time);
    const bEnd = timeToMinutes(b.end_time);
    return aStart < bEnd && aEnd > bStart;
  };

  const groups: MeetingData[][] = [];
  let currentGroup: MeetingData[] = [];
  let currentGroupEnd = -1;

  for (const meeting of withTime) {
    const startMin = timeToMinutes(meeting.start_time);
    const endMin = timeToMinutes(meeting.end_time);

    if (currentGroup.length > 0 && startMin >= currentGroupEnd) {
      groups.push(currentGroup);
      currentGroup = [];
      currentGroupEnd = -1;
    }

    currentGroup.push(meeting);
    currentGroupEnd = Math.max(currentGroupEnd, endMin);
  }

  if (currentGroup.length > 0) groups.push(currentGroup);

  const result: OverlapInfo[] = [];

  for (const group of groups) {
    if (group.length === 1) {
      result.push({ meeting: group[0], leftPct: 0, widthPct: 100, zIndex: 10, isNested: false });
      continue;
    }

    const columns: MeetingData[][] = [];
    const columnByMeetingId = new Map<string, number>();

    for (const meeting of group) {
      const startMin = timeToMinutes(meeting.start_time);
      let columnIndex = columns.findIndex(column => {
        const last = column[column.length - 1];
        return timeToMinutes(last.end_time) <= startMin;
      });

      if (columnIndex === -1) {
        columnIndex = columns.length;
        columns.push([]);
      }

      columns[columnIndex].push(meeting);
      columnByMeetingId.set(meeting.id, columnIndex);
    }

    const totalColumns = columns.length;

    for (const meeting of group) {
      const columnIndex = columnByMeetingId.get(meeting.id) ?? 0;
      let columnSpan = 1;

      for (let nextColumn = columnIndex + 1; nextColumn < totalColumns; nextColumn += 1) {
        if (columns[nextColumn].some(other => overlaps(meeting, other))) break;
        columnSpan += 1;
      }

      result.push({
        meeting,
        leftPct: (columnIndex / totalColumns) * 100,
        widthPct: (columnSpan / totalColumns) * 100,
        zIndex: 10 + columnIndex,
        isNested: false,
      });
    }
  }

  return result;
}

export function renderSlotLines(
  n: number,
  slotHeight: number,
  hideOffHours: boolean,
  workStartMin: number,
  workEndMin: number,
) {
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
        <div
          key={i}
          className={`absolute left-0 right-0 ${i % 2 === 1
            ? 'border-b-2 border-slate-300/90 dark:border-slate-600/90'
            : 'border-b border-slate-200/90 dark:border-slate-700/90'}`}
          style={{ top: `${(i + 1) * slotHeight}px` }}
        />
      ))}
    </div>
  );
}

export function renderCurrentTimeLine(
  jy: number, jm: number, jd: number,
  slotHeight: number,
  isToday: (jy: number, jm: number, jd: number) => boolean,
  currentTime: Date,
  showLabel = true,
) {
  if (!isToday(jy, jm, jd)) return null;
  const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
  const top = ((nowMin - HOURS_START * 60) / 30) * slotHeight;
  const timeLabel = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
  return (
    <div className="absolute left-0 right-0 z-40 pointer-events-none" style={{ top: `${top}px` }}>
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

function getAdaptiveMeetingTitleStyle(
  slotHeight: number,
  colWidthMultiple: number,
  visualHeight: number,
): React.CSSProperties {
  const columnScale = colWidthMultiple >= 7
    ? 0.72
    : colWidthMultiple >= 4
      ? 0.82
      : colWidthMultiple === 3
        ? 0.9
        : 1;
  const heightScale = visualHeight < 28 ? 0.78 : visualHeight < 48 ? 0.9 : 1;
  const zoomBase = Math.min(16, Math.max(9.5, 8 + slotHeight * 0.12));
  const ideal = zoomBase * columnScale * heightScale;
  const min = Math.max(7, ideal * 0.84);
  const max = Math.max(min, Math.min(17, ideal * 1.2));

  return {
    fontSize: `clamp(${min.toFixed(2)}px, calc(${ideal.toFixed(2)}px + 0.18vw), ${max.toFixed(2)}px)`,
    lineHeight: 1.15,
  };
}

export function renderMeetingBlock(
  p: CalendarViewProps,
  meeting: MeetingData,
  colWidthMultiple = 1,
  leftPct = 0,
  widthPct = 100,
  blockZIndex = 10,
  isNested = false,
) {
  const {
    slotHeight, viewMode, currentUserId, getMeetingColor,
    dragMoveMeeting, dragMoveOriginalSlot, dragMoveOriginalEndSlot,
    dragMoveCurrentDeltaSlot, dragMoveCurrentDeltaDay, dragMovedRef,
    setDragMoveMeeting, setDragMoveStartY, setDragMoveStartX,
    setDragMoveOriginalSlot, setDragMoveOriginalEndSlot,
    setDragMoveCurrentDeltaSlot, setDragMoveCurrentDeltaDay, setDragMoveOriginalDate,
    resizeMeeting, resizeOriginalEndSlot, resizeCurrentDelta,
    setResizeMeeting, setResizeStartY, setResizeOriginalEndSlot, setResizeCurrentDelta,
    setPreviewMeeting, setDetailMeeting, handleEditMeeting, handleBlockClick,
  } = p;

  const startMin = timeToMinutes(meeting.start_time);
  const endMin = timeToMinutes(meeting.end_time);
  if (startMin < 0 || endMin < 0) return null;

  const renderStartSlot = startMin / 30;
  const renderEndSlot = endMin / 30;
  const startSlot = minutesToSlotIndex(startMin);
  const endSlot = minutesToSlotIndex(endMin);
  const height = Math.max((renderEndSlot - renderStartSlot) * slotHeight, slotHeight * 0.6);
  const color = getMeetingColor(meeting);
  const isBeingDragged = dragMoveMeeting?.id === meeting.id;
  const isBeingResized = resizeMeeting?.id === meeting.id;
  const visualTop = isBeingDragged ? (dragMoveOriginalSlot + dragMoveCurrentDeltaSlot) * slotHeight : renderStartSlot * slotHeight;
  const visualHeight = isBeingResized
    ? Math.max((resizeOriginalEndSlot + resizeCurrentDelta - startSlot) * slotHeight, slotHeight * 0.6)
    : height;
  const origDateStr = parseRequestDateToDateStr(meeting.request_date) || '';
  const canMove = meeting.user_id === currentUserId || meeting.meeting_manager === currentUserId;
  const isTiny = visualHeight < 28;
  const titleStyle = getAdaptiveMeetingTitleStyle(slotHeight, colWidthMultiple, visualHeight);

  const GUTTER = 2;
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
    if (e.touches.length !== 1) return;

    clearMeetingTouchHold(meeting.id);
    const t = e.touches[0];
    const startX = t.clientX;
    const startY = t.clientY;
    const state: MeetingTouchHoldState = {
      timer: 0,
      startX,
      startY,
      activated: false,
    };

    if (canMove && origDateStr) {
      state.timer = window.setTimeout(() => {
        const current = meetingTouchHoldStates.get(meeting.id);
        if (!current) return;
        current.activated = true;
        dragMovedRef.current = false;
        setPreviewMeeting(null);
        setDragMoveMeeting(meeting);
        setDragMoveStartY(startY);
        setDragMoveStartX(startX);
        setDragMoveOriginalSlot(startSlot);
        setDragMoveOriginalEndSlot(endSlot);
        setDragMoveCurrentDeltaSlot(0);
        setDragMoveCurrentDeltaDay(0);
        setDragMoveOriginalDate(origDateStr);
      }, MEETING_TOUCH_LONG_PRESS_MS);
    }

    meetingTouchHoldStates.set(meeting.id, state);
  };
  const onBlockTouchMove = (e: React.TouchEvent) => {
    const state = meetingTouchHoldStates.get(meeting.id);
    if (!state || e.touches.length !== 1) return;

    const t = e.touches[0];
    if (!state.activated) {
      const dx = t.clientX - state.startX;
      const dy = t.clientY - state.startY;
      if (Math.abs(dx) > MEETING_TOUCH_MOVE_CANCEL_PX || Math.abs(dy) > MEETING_TOUCH_MOVE_CANCEL_PX) {
        clearMeetingTouchHold(meeting.id);
      }
      return;
    }

    e.preventDefault();
  };
  const onBlockTouchEnd = () => {
    const state = meetingTouchHoldStates.get(meeting.id);
    if (!state) return;
    if (state.activated) {
      meetingTouchSuppressClickUntil.set(meeting.id, Date.now() + 700);
      clearMeetingTouchHold(meeting.id);
      return;
    }

    clearMeetingTouchHold(meeting.id);
    const now = Date.now();
    const lastTapAt = meetingTouchLastTapAt.get(meeting.id) || 0;
    const existingTimer = meetingTouchSingleTapTimers.get(meeting.id);
    meetingTouchSuppressClickUntil.set(meeting.id, now + MEETING_DOUBLE_TAP_MS + 80);

    if (lastTapAt > 0 && now - lastTapAt <= MEETING_DOUBLE_TAP_MS) {
      if (existingTimer) window.clearTimeout(existingTimer);
      meetingTouchSingleTapTimers.delete(meeting.id);
      meetingTouchLastTapAt.delete(meeting.id);
      setPreviewMeeting(null);
      setDetailMeeting(meeting);
      return;
    }

    meetingTouchLastTapAt.set(meeting.id, now);
    if (existingTimer) window.clearTimeout(existingTimer);
    const timer = window.setTimeout(() => {
      meetingTouchSingleTapTimers.delete(meeting.id);
      meetingTouchLastTapAt.delete(meeting.id);
      setPreviewMeeting(meeting);
    }, MEETING_DOUBLE_TAP_MS);
    meetingTouchSingleTapTimers.set(meeting.id, timer);
  };
  const onBlockTouchCancel = () => {
    clearMeetingTouchHold(meeting.id);
  };
  const onResizeDown = (e: React.MouseEvent) => {
    if (!canMove) return; e.stopPropagation(); e.preventDefault();
    setResizeMeeting(meeting); setResizeStartY(e.clientY); setResizeOriginalEndSlot(endSlot); setResizeCurrentDelta(0);
  };
  const onResizeTouch = (e: React.TouchEvent) => {
    e.stopPropagation();
    if (!canMove || e.touches.length !== 1) return;

    clearMeetingResizeTouchHold(meeting.id);
    const t = e.touches[0];
    const startX = t.clientX;
    const startY = t.clientY;
    const state: MeetingTouchHoldState = {
      timer: 0,
      startX,
      startY,
      activated: false,
    };

    state.timer = window.setTimeout(() => {
      const current = meetingResizeTouchHoldStates.get(meeting.id);
      if (!current) return;
      current.activated = true;
      setResizeMeeting(meeting);
      setResizeStartY(startY);
      setResizeOriginalEndSlot(endSlot);
      setResizeCurrentDelta(0);
    }, MEETING_TOUCH_LONG_PRESS_MS);

    meetingResizeTouchHoldStates.set(meeting.id, state);
  };
  const onResizeTouchMove = (e: React.TouchEvent) => {
    const state = meetingResizeTouchHoldStates.get(meeting.id);
    if (!state || e.touches.length !== 1) return;

    const t = e.touches[0];
    if (!state.activated) {
      e.stopPropagation();
      const dx = t.clientX - state.startX;
      const dy = t.clientY - state.startY;
      if (Math.abs(dx) > MEETING_TOUCH_MOVE_CANCEL_PX || Math.abs(dy) > MEETING_TOUCH_MOVE_CANCEL_PX) {
        clearMeetingResizeTouchHold(meeting.id);
      }
      return;
    }

    e.preventDefault();
  };
  const onResizeTouchEnd = (e: React.TouchEvent) => {
    const state = meetingResizeTouchHoldStates.get(meeting.id);
    if (!state?.activated) e.stopPropagation();
    if (state?.activated) {
      meetingTouchSuppressClickUntil.set(meeting.id, Date.now() + 700);
    }
    clearMeetingResizeTouchHold(meeting.id);
  };
  const onResizeTouchCancel = (e: React.TouchEvent) => {
    e.stopPropagation();
    clearMeetingResizeTouchHold(meeting.id);
  };

  let ghostStyle: React.CSSProperties = {};
  if (isBeingDragged && viewMode === 'week' && dragMoveCurrentDeltaDay !== 0) {
    const dayColWidth = 100 / 7;
    ghostStyle = { transform: `translateX(${-dragMoveCurrentDeltaDay * dayColWidth * colWidthMultiple}%)` };
  }

  return (
    <div key={meeting.id}
      className={`absolute rounded-lg overflow-hidden select-none group ${isNested ? 'ring-[3px] ring-white dark:ring-gray-900 shadow-[0_2px_8px_rgba(0,0,0,0.35)] border-2 border-white/80 dark:border-gray-900/80' : 'border-2 border-white/60 dark:border-gray-900/60 shadow-sm'} ${(isBeingDragged || isBeingResized) ? 'shadow-2xl opacity-90 cursor-grabbing' : canMove ? 'cursor-grab hover:shadow-xl' : 'cursor-pointer hover:shadow-xl'} transition-shadow`}
      style={{ top: `${visualTop}px`, height: `${visualHeight}px`, backgroundColor: color, zIndex: (isBeingDragged || isBeingResized) ? 30 : blockZIndex, touchAction: isBeingDragged ? 'none' : 'pan-x pan-y', ...insetStyle, transition: (isBeingDragged || isBeingResized) ? 'none' : 'box-shadow 0.15s', ...ghostStyle }}
      onMouseDown={onBlockDown}
      onTouchStart={onBlockTouch}
      onTouchMove={onBlockTouchMove}
      onTouchEnd={onBlockTouchEnd}
      onTouchCancel={onBlockTouchCancel}
      onMouseUp={e => {
        e.stopPropagation();
        if (dragMovedRef.current) {
          document.dispatchEvent(new MouseEvent('mouseup', {
            bubbles: false,
            clientX: e.clientX,
            clientY: e.clientY,
          }));
          return;
        }
        setDragMoveMeeting(null);
        setDragMoveCurrentDeltaSlot(0);
        setDragMoveCurrentDeltaDay(0);
      }}
      onClick={e => {
        e.stopPropagation();
        const suppressUntil = meetingTouchSuppressClickUntil.get(meeting.id) || 0;
        if (suppressUntil > Date.now()) return;
        meetingTouchSuppressClickUntil.delete(meeting.id);
        handleBlockClick(meeting, e);
      }}
      onDoubleClick={e => {
        e.stopPropagation();
        e.preventDefault();
        if (dragMovedRef.current || resizeMeeting?.id === meeting.id) return;
        setPreviewMeeting(null);
        setDetailMeeting(meeting);
      }}
    >
      <div className="px-2 py-1 h-full flex items-start overflow-hidden">
        <div
          className={`text-white font-semibold ${isTiny ? 'truncate' : 'line-clamp-2'} flex-shrink-0`}
          style={titleStyle}
        >
          {meeting.subject}
        </div>
        {canMove && !isTiny && (
          <button onClick={e => { e.stopPropagation(); handleEditMeeting(meeting); }} onMouseDown={e => e.stopPropagation()} onTouchStart={e => e.stopPropagation()}
            className="absolute top-1 left-1 p-0.5 text-white/50 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity bg-black/20 rounded">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        )}
      </div>
      {canMove && (
        <div
          className={`absolute bottom-0 left-0 right-0 h-2.5 cursor-ns-resize flex items-center justify-center ${isBeingResized ? 'bg-black/20' : 'opacity-0 group-hover:opacity-100 hover:bg-black/20 transition-opacity'}`}
          style={{ touchAction: isBeingResized ? 'none' : 'pan-x pan-y' }}
          onMouseDown={onResizeDown}
          onMouseUp={e => {
            e.stopPropagation();
            if (resizeMeeting?.id === meeting.id) {
              document.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: false,
                clientX: e.clientX,
                clientY: e.clientY,
              }));
            }
          }}
          onClick={e => e.stopPropagation()}
          onDoubleClick={e => { e.stopPropagation(); e.preventDefault(); }}
          onTouchStart={onResizeTouch}
          onTouchMove={onResizeTouchMove}
          onTouchEnd={onResizeTouchEnd}
          onTouchCancel={onResizeTouchCancel}
        >
          <div className="w-6 h-0.5 rounded-full bg-white/60" />
        </div>
      )}
    </div>
  );
}

export function renderMeetingsWithOverlap(
  p: CalendarViewProps,
  mts: MeetingData[],
  colWidthMultiple = 1,
) {
  const assigned = computeOverlapLayers(mts);
  const withTimeIds = new Set(assigned.map(a => a.meeting.id));
  const noTime = mts.filter(m => !withTimeIds.has(m.id));
  return [
    ...assigned.map(({ meeting, leftPct, widthPct, zIndex, isNested }) =>
      renderMeetingBlock(p, meeting, colWidthMultiple, leftPct, widthPct, zIndex, isNested)
    ),
    ...noTime.map(m => renderMeetingBlock(p, m, colWidthMultiple)),
  ];
}

export function renderPreviewPopup(p: CalendarViewProps) {
  const {
    previewMeeting, previewPos, previewRef, getMeetingColor, resolveName,
    toFarsiTime, currentUserId, setPreviewMeeting, setDetailMeeting, handleEditMeeting,
  } = p;
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

export function renderHourColumn(
  slotHeight: number,
  adjustSlotHeight: (delta: number) => void,
  handleHourColTouchStart: (e: React.TouchEvent) => void,
  handleHourColTouchMove: (e: React.TouchEvent) => void,
  handleHourColTouchEnd: () => void,
) {
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

export function getOffHoursStyles(p: CalendarViewProps) {
  const { hideOffHours, visibleStartHour, visibleEndHour, slotHeight } = p;
  const offHoursWrapStyle = hideOffHours ? {
    overflow: 'hidden',
    height: `${(visibleEndHour - visibleStartHour) * slotHeight * 2}px`,
  } : undefined;
  const offHoursInnerStyle = hideOffHours ? { marginTop: `-${visibleStartHour * slotHeight * 2}px` } : undefined;
  return { offHoursWrapStyle, offHoursInnerStyle };
}
