import React from 'react';
import { Plus, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { JALAALI_WEEKDAYS } from './utils';
import { jalaaliToDate, jsDayToWeekday, minutesToTime } from './utils';
import type { CalendarViewProps } from './viewShared';
import { SlotLines, CurrentTimeLine, HourColumn, renderMeetingsWithOverlap } from './viewShared';

export function DayView(p: CalendarViewProps) {
  const { slotHeight, totalSlots, hideOffHours, workStartMin, workEndMin, visibleStartHour, visibleEndHour,
    selectedJy, selectedJm, selectedJd, currentTime, isToday,
    getOccasionsForDay, getAllDayEventsForDay, fetchAllDayEvents,
    setAllDayFormDate, setShowAllDayForm,
    timeGridRef, timeScrollRef, dayGridRef,
    handleGridMouseDown, handleGridMouseMove, handleGridTouchStart, handleGridTouchMove, commitDrag,
    handleHourColTouchStart, handleHourColTouchMove, handleHourColTouchEnd,
    isDragging, dragStartSlot, dragEndSlot, dragDate, dragMoveMeeting,
    getMeetings, adjustSlotHeight } = p;

  const dayOcc = getOccasionsForDay(selectedJy, selectedJm, selectedJd);
  const dayIsHoliday = dayOcc.some((o: any) => o.is_holiday);
  const weekdayIdx = jsDayToWeekday(jalaaliToDate(selectedJy, selectedJm, selectedJd).getDay());

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
            <HourColumn slotHeight={slotHeight} adjustSlotHeight={adjustSlotHeight} handleHourColTouchStart={handleHourColTouchStart} handleHourColTouchMove={handleHourColTouchMove} handleHourColTouchEnd={handleHourColTouchEnd} />
            <div className="flex-1 relative select-none touch-none border-r border-gray-100 dark:border-gray-700"
              ref={timeGridRef}
              onMouseDown={e => handleGridMouseDown(e, selectedJy, selectedJm, selectedJd)}
              onMouseMove={handleGridMouseMove} onMouseUp={commitDrag}
              onMouseLeave={() => { if (isDragging && !dragMoveMeeting) commitDrag(); }}
              onTouchStart={e => { if (e.touches.length === 2) { handleHourColTouchStart(e); } else { handleGridTouchStart(e, selectedJy, selectedJm, selectedJd); } }}
              onTouchMove={e => { if (e.touches.length === 2) { handleHourColTouchMove(e); } else { handleGridTouchMove(e); } }}
              onTouchEnd={() => { handleHourColTouchEnd(); commitDrag(); }}
            >
              <SlotLines n={totalSlots} slotHeight={slotHeight} workStartMin={workStartMin} workEndMin={workEndMin} hideOffHours={hideOffHours} />
              <CurrentTimeLine jy={selectedJy} jm={selectedJm} jd={selectedJd} currentTime={currentTime} slotHeight={slotHeight} isToday={isToday} />
              {renderMeetingsWithOverlap(p, getMeetings(selectedJy, selectedJm, selectedJd), 1)}
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
