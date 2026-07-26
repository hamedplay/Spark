import React from 'react';
import { Plus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { MeetingData } from './types';
import { MeetingBlock } from './MeetingBlock';
import { computeOverlapLayers } from './overlap';
import {
  JALAALI_WEEKDAYS, HOURS_START, HOURS_END,
  parseRequestDateToDateStr, jalaaliToDate, jsDayToWeekday,
  jalaaliToYYYYMMDD, minutesToTime,
} from './utils';

export interface DayViewProps {
  selectedJy: number; selectedJm: number; selectedJd: number;
  slotHeight: number; totalSlots: number;
  hideOffHours: boolean; visibleStartHour: number; visibleEndHour: number;
  workStartMin: number; workEndMin: number;
  currentTime: Date; currentUserId: string | null;
  getMeetings: (jy: number, jm: number, jd: number) => MeetingData[];
  getMeetingColor: (m: MeetingData) => string;
  isToday: (jy: number, jm: number, jd: number) => boolean;
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
  getOccasionsForDay: (jy: number, jm: number, jd: number) => any[];
  getAllDayEventsForDay: (jy: number, jm: number, jd: number) => any[];
  fetchAllDayEvents: () => void;
  setAllDayFormDate: (v: { jy: number; jm: number; jd: number } | null) => void;
  setShowAllDayForm: (v: boolean) => void;
  timeGridRef: React.MutableRefObject<HTMLDivElement | null>;
  timeScrollRef: React.MutableRefObject<HTMLDivElement | null>;
  dayGridRef: React.MutableRefObject<HTMLDivElement | null>;
  blockProps: Omit<MeetingBlockProps, 'meeting' | 'colWidthMultiple' | 'leftPct' | 'widthPct' | 'blockZIndex' | 'isNested'>;
}

import type { MeetingBlockProps } from './MeetingBlock';

export function DayView(p: DayViewProps) {
  const {
    selectedJy, selectedJm, selectedJd, slotHeight, totalSlots,
    hideOffHours, visibleStartHour, visibleEndHour, workStartMin, workEndMin,
    currentTime, currentUserId, getMeetings, getMeetingColor, isToday, toFarsiTime,
    isDragging, dragStartSlot, dragEndSlot, dragDate,
    dragMoveMeeting, dragMoveOriginalSlot, dragMoveOriginalEndSlot,
    dragMoveCurrentDeltaSlot, dragMoveCurrentDeltaDay, dragMovedRef,
    resizeMeeting, resizeOriginalEndSlot, resizeCurrentDelta,
    setDragMoveMeeting, setDragMoveStartY, setDragMoveStartX,
    setDragMoveOriginalSlot, setDragMoveOriginalEndSlot,
    setDragMoveCurrentDeltaSlot, setDragMoveCurrentDeltaDay, setDragMoveOriginalDate,
    setResizeMeeting, setResizeStartY, setResizeOriginalEndSlot, setResizeCurrentDelta,
    setPreviewMeeting, handleGridMouseDown, handleGridMouseMove, handleGridTouchStart, handleGridTouchMove,
    commitDrag, handleHourColTouchStart, handleHourColTouchMove, handleHourColTouchEnd,
    adjustSlotHeight, handleEditMeeting, handleBlockClick,
    getOccasionsForDay, getAllDayEventsForDay, fetchAllDayEvents,
    setAllDayFormDate, setShowAllDayForm,
    timeGridRef, timeScrollRef, dayGridRef, blockProps,
  } = p;

  const dayOcc = getOccasionsForDay(selectedJy, selectedJm, selectedJd);
  const dayIsHoliday = dayOcc.some((o: any) => o.is_holiday);
  const weekdayIdx = jsDayToWeekday(jalaaliToDate(selectedJy, selectedJm, selectedJd).getDay());

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

  const renderMeetingsWithOverlap = (mts: MeetingData[], colWidthMultiple = 1) => {
    const assigned = computeOverlapLayers(mts);
    const withTimeIds = new Set(assigned.map(a => a.meeting.id));
    const noTime = mts.filter(m => !withTimeIds.has(m.id));
    return [
      ...assigned.map(({ meeting, leftPct, widthPct, zIndex, isNested }) =>
        <MeetingBlock key={meeting.id} {...blockProps} meeting={meeting} colWidthMultiple={colWidthMultiple} leftPct={leftPct} widthPct={widthPct} blockZIndex={zIndex} isNested={isNested} />
      ),
      ...noTime.map(m => <MeetingBlock key={m.id} {...blockProps} meeting={m} colWidthMultiple={colWidthMultiple} />),
    ];
  };

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
}
