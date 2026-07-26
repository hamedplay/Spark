import React from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { MeetingData } from './types';
import { MeetingBlock } from './MeetingBlock';
import { computeOverlapLayers } from './overlap';
import {
  JALAALI_WEEKDAYS, HOURS_START, HOURS_END,
  parseRequestDateToDateStr, jalaaliToYYYYMMDD,
} from './utils';
import type { MeetingBlockProps } from './MeetingBlock';

export interface WeekViewProps {
  weekDays: Array<{ jy: number; jm: number; jd: number; weekday: number }>;
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
  setSelectedJy: (v: number) => void;
  setSelectedJm: (v: number) => void;
  setSelectedJd: (v: number) => void;
  setViewMode: (v: string) => void;
  getOccasionsForDay: (jy: number, jm: number, jd: number) => any[];
  getAllDayEventsForDay: (jy: number, jm: number, jd: number) => any[];
  fetchAllDayEvents: () => void;
  isInAllDayDragRange: (jy: number, jm: number, jd: number) => boolean;
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
  blockProps: Omit<MeetingBlockProps, 'meeting' | 'colWidthMultiple' | 'leftPct' | 'widthPct' | 'blockZIndex' | 'isNested'>;
}

export function WeekView(p: WeekViewProps) {
  const {
    weekDays, slotHeight, totalSlots, hideOffHours, visibleStartHour, visibleEndHour,
    workStartMin, workEndMin, currentTime, currentUserId, getMeetings, getMeetingColor,
    isToday, toFarsiTime, isDragging, dragStartSlot, dragEndSlot, dragDate,
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
    setSelectedJy, setSelectedJm, setSelectedJd, setViewMode,
    getOccasionsForDay, getAllDayEventsForDay, fetchAllDayEvents, isInAllDayDragRange,
    allDayDragging, allDayDragStart, allDayDragEnd,
    setAllDayDragStart, setAllDayDragEnd, setAllDayDragging,
    setAllDayFormDate, setAllDayFormEndDate, setShowAllDayForm,
    timeGridRef, timeScrollRef, weekGridRef, blockProps,
  } = p;

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

  const offHoursWrapStyle = hideOffHours ? {
    overflow: 'hidden',
    height: `${(visibleEndHour - visibleStartHour) * slotHeight * 2}px`,
  } : undefined;
  const offHoursInnerStyle = hideOffHours ? { marginTop: `-${visibleStartHour * slotHeight * 2}px` } : undefined;

  return (
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
}
