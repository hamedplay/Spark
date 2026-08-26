import React from 'react';
import { X, Plus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { JALAALI_WEEKDAYS, jsDayToWeekday, jalaaliToDate, minutesToTime, toFarsiDigits, timeToMinutes } from './utils';
import { CalendarViewProps } from './CalendarViewTypes';
import { useCalendarTouchGestures } from './useCalendarTouchGestures';

function formatMeetingDuration(totalMinutes: number): string {
  if (totalMinutes <= 0) return '۰ ساعت';
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) return `${toFarsiDigits(hours)} ساعت و ${toFarsiDigits(minutes)} دقیقه`;
  if (hours > 0) return `${toFarsiDigits(hours)} ساعت`;
  return `${toFarsiDigits(minutes)} دقیقه`;
}

function getMeetingTotalMinutes(meetings: Array<{ start_time?: string; end_time?: string }>): number {
  return meetings.reduce((total, meeting) => {
    const start = timeToMinutes(meeting.start_time || '');
    const end = timeToMinutes(meeting.end_time || '');
    return total + (start >= 0 && end > start ? end - start : 0);
  }, 0);
}
import {
  renderSlotLines, renderCurrentTimeLine, renderHourColumn, renderMeetingsWithOverlap, getOffHoursStyles,
} from './CalendarViewShared';

export function DayView(p: CalendarViewProps) {
  const {
    selectedJy, selectedJm, selectedJd, slotHeight, totalSlots,
    isToday, getOccasionsForDay, getAllDayEventsForDay, fetchAllDayEvents,
    getMeetings, setAllDayFormDate, setShowAllDayForm,
    timeGridRef, timeScrollRef, dayGridRef,
    handleGridMouseDown, handleGridMouseMove, commitDrag,
    handleHourColTouchStart, handleHourColTouchMove, handleHourColTouchEnd,
    adjustSlotHeight,
    isDragging, dragStartSlot, dragEndSlot, dragDate, dragMoveMeeting,
    dragMoveOriginalSlot, dragMoveCurrentDeltaSlot,
  } = p;

  const touchGestures = useCalendarTouchGestures(p, true);
  const { offHoursWrapStyle, offHoursInnerStyle } = getOffHoursStyles(p);
  const dayOcc = getOccasionsForDay(selectedJy, selectedJm, selectedJd);
  const dayIsHoliday = dayOcc.some((o: any) => o.is_holiday);
  const weekdayIdx = jsDayToWeekday(jalaaliToDate(selectedJy, selectedJm, selectedJd).getDay());
  const dayMeetings = getMeetings(selectedJy, selectedJm, selectedJd);
  const dayMeetingDuration = formatMeetingDuration(getMeetingTotalMinutes(dayMeetings));
  const dragTargetSlot = dragMoveMeeting
    ? Math.max(0, Math.min(totalSlots, dragMoveOriginalSlot + dragMoveCurrentDeltaSlot))
    : null;
  const dragTargetTime = dragTargetSlot !== null
    ? toFarsiDigits(minutesToTime(dragTargetSlot * 30))
    : null;

  return (
    <div className="mx-2 mb-2 mt-1 flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-none sm:mx-3 sm:mb-3">
      <div className="flex-shrink-0 border-b border-slate-200/80 dark:border-slate-800">
        <div className="flex bg-white dark:bg-slate-950">
          <div className="w-14 flex-shrink-0" />
          <div className="flex-1 py-2 text-center">
            <div className={`text-xs ${weekdayIdx === 6 || dayIsHoliday ? 'font-bold text-rose-500 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
              {JALAALI_WEEKDAYS[weekdayIdx]}
            </div>
            <div className={`mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-xl text-xl font-bold ${isToday(selectedJy, selectedJm, selectedJd)
              ? 'bg-violet-600 text-white shadow-sm dark:bg-violet-500'
              : 'bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-white'}`}>
              {selectedJd}
            </div>
          </div>
        </div>

        <div className="flex min-h-[34px] flex-wrap items-start gap-2 border-t border-slate-200/90 bg-slate-50/70 px-2 py-1.5 dark:border-slate-800 dark:bg-slate-900/60">
          <span className="w-14 flex-shrink-0 pt-0.5 text-center text-[10px] font-bold leading-tight text-slate-600 dark:text-slate-300">{dayMeetingDuration}</span>
          <div className="flex flex-1 flex-wrap gap-1">
            {dayOcc.map((o: any) => (
              <span key={o.id} className={`rounded-full px-2 py-0.5 text-[10px] ${o.is_holiday
                ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
                : o.is_celebration
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                  : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                {o.title}
              </span>
            ))}

            {getAllDayEventsForDay(selectedJy, selectedJm, selectedJd).map((ev: any) => (
              <span key={ev.id} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${ev.type === 'leave'
                ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300'
                : ev.type === 'meeting'
                  ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300'
                  : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>
                {ev.title}
                <button type="button" onClick={async () => { await supabase.from('all_day_events').delete().eq('id', ev.id); fetchAllDayEvents(); }} className="hover:opacity-70">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}

            <button
              type="button"
              onClick={() => { setAllDayFormDate({ jy: selectedJy, jm: selectedJm, jd: selectedJd }); setShowAllDayForm(true); }}
              className="flex items-center gap-0.5 rounded-full border border-dashed border-violet-300 bg-white px-2 py-0.5 text-[10px] text-violet-600 transition-colors hover:bg-violet-50 dark:border-violet-500/40 dark:bg-slate-900 dark:text-violet-300 dark:hover:bg-violet-500/10"
            >
              <Plus className="h-2.5 w-2.5" />
              افزودن
            </button>
          </div>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto overscroll-y-contain"
        ref={el => { (timeGridRef as any).current = el; (timeScrollRef as any).current = el; }}
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div style={offHoursWrapStyle}>
          <div className="flex bg-white dark:bg-slate-950" ref={dayGridRef} style={offHoursInnerStyle}>
            <div className="relative w-14 flex-shrink-0">
              {renderHourColumn(slotHeight, adjustSlotHeight, handleHourColTouchStart, handleHourColTouchMove, handleHourColTouchEnd)}
              {dragTargetSlot !== null && dragTargetTime && (
                <div
                  className="pointer-events-none absolute left-1 right-1 z-30 -translate-y-1/2 rounded-full bg-rose-500 px-1 py-0.5 text-center text-[9px] font-bold leading-none text-white shadow-sm"
                  style={{ top: `${dragTargetSlot * slotHeight}px` }}
                >
                  {dragTargetTime}
                </div>
              )}
            </div>
            <div
              className="relative flex-1 select-none border-r border-slate-200/90 dark:border-slate-700/80"
              style={{ touchAction: 'pan-y' }}
              ref={timeGridRef}
              onMouseDown={e => { e.preventDefault(); handleGridMouseDown(e, selectedJy, selectedJm, selectedJd); }}
              onMouseMove={e => { if (isDragging) e.preventDefault(); handleGridMouseMove(e); }}
              onMouseUp={commitDrag}
              onMouseLeave={() => { if (isDragging && !dragMoveMeeting) commitDrag(); }}
              onTouchStart={e => touchGestures.handleTouchStart(e, { jy: selectedJy, jm: selectedJm, jd: selectedJd })}
              onTouchMove={touchGestures.handleTouchMove}
              onTouchEnd={touchGestures.handleTouchEnd}
              onTouchCancel={touchGestures.handleTouchCancel}
            >
              {renderSlotLines(totalSlots, slotHeight, p.hideOffHours, p.workStartMin, p.workEndMin)}
              {renderCurrentTimeLine(selectedJy, selectedJm, selectedJd, slotHeight, isToday, p.currentTime)}
              {dragTargetSlot !== null && (
                <div
                  className="pointer-events-none absolute left-0 right-0 z-[25]"
                  style={{ top: `${dragTargetSlot * slotHeight}px` }}
                >
                  <div className="h-0.5 w-full bg-rose-500 shadow-[0_0_0_1px_rgba(244,63,94,0.08)]" />
                </div>
              )}
              {renderMeetingsWithOverlap(p, dayMeetings, 1)}
              {isDragging && dragStartSlot !== null && dragEndSlot !== null && dragDate && dragDate.jy === selectedJy && dragDate.jm === selectedJm && dragDate.jd === selectedJd && (() => {
                const s = Math.min(dragStartSlot, dragEndSlot);
                const e = Math.max(dragStartSlot, dragEndSlot) + 1;
                return (
                  <div className="pointer-events-none absolute left-1 right-1 z-5 rounded-lg border border-violet-500 bg-violet-500/15" style={{ top: `${s * slotHeight}px`, height: `${(e - s) * slotHeight}px` }}>
                    <div className="px-2 py-0.5 text-xs font-bold text-violet-700 dark:text-violet-300">{minutesToTime(s * 30)} - {minutesToTime(e * 30)}</div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}