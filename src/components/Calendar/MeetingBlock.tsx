import React from 'react';
import { Clock, MapPin } from 'lucide-react';
import { MeetingData } from './types';
import {
  parseRequestDateToDateStr, minutesToTime, timeToMinutes, minutesToSlotIndex,
} from './utils';

export interface MeetingBlockProps {
  meeting: MeetingData;
  colWidthMultiple?: number;
  leftPct?: number;
  widthPct?: number;
  blockZIndex?: number;
  isNested?: boolean;
  slotHeight: number;
  viewMode: string;
  currentUserId: string | null;
  getMeetingColor: (m: MeetingData) => string;
  toFarsiTime: (t: string) => string;
  dragMoveMeeting: MeetingData | null;
  dragMoveOriginalSlot: number;
  dragMoveOriginalEndSlot: number;
  dragMoveCurrentDeltaSlot: number;
  dragMoveCurrentDeltaDay: number;
  dragMovedRef: React.MutableRefObject<boolean>;
  resizeMeeting: MeetingData | null;
  resizeOriginalEndSlot: number;
  resizeCurrentDelta: number;
  setDragMoveMeeting: (m: MeetingData | null) => void;
  setDragMoveStartY: (v: number) => void;
  setDragMoveStartX: (v: number) => void;
  setDragMoveOriginalSlot: (v: number) => void;
  setDragMoveOriginalEndSlot: (v: number) => void;
  setDragMoveCurrentDeltaSlot: (v: number) => void;
  setDragMoveCurrentDeltaDay: (v: number) => void;
  setDragMoveOriginalDate: (v: string) => void;
  setResizeMeeting: (m: MeetingData | null) => void;
  setResizeStartY: (v: number) => void;
  setResizeOriginalEndSlot: (v: number) => void;
  setResizeCurrentDelta: (v: number) => void;
  setPreviewMeeting: (m: MeetingData | null) => void;
  handleEditMeeting: (m: MeetingData) => void;
  handleBlockClick: (m: MeetingData, e: React.MouseEvent) => void;
}

export function MeetingBlock(p: MeetingBlockProps) {
  const {
    meeting, colWidthMultiple = 1, leftPct = 0, widthPct = 100, blockZIndex = 10, isNested = false,
    slotHeight, viewMode, currentUserId, getMeetingColor, toFarsiTime,
    dragMoveMeeting, dragMoveOriginalSlot, dragMoveOriginalEndSlot,
    dragMoveCurrentDeltaSlot, dragMoveCurrentDeltaDay, dragMovedRef,
    resizeMeeting, resizeOriginalEndSlot, resizeCurrentDelta,
    setDragMoveMeeting, setDragMoveStartY, setDragMoveStartX,
    setDragMoveOriginalSlot, setDragMoveOriginalEndSlot,
    setDragMoveCurrentDeltaSlot, setDragMoveCurrentDeltaDay, setDragMoveOriginalDate,
    setResizeMeeting, setResizeStartY, setResizeOriginalEndSlot, setResizeCurrentDelta,
    setPreviewMeeting, handleEditMeeting, handleBlockClick,
  } = p;

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
