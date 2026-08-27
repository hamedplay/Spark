import React from 'react';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  HOURS_START, HOURS_END, JALAALI_WEEKDAYS,
  parseRequestDateToDateStr, jalaaliToYYYYMMDD, minutesToTime,
} from './utils';
import { CalendarViewProps } from './CalendarViewTypes';
import {
  renderSlotLines, renderMeetingsWithOverlap, getOffHoursStyles,
} from './CalendarViewShared';

function shouldUseScrollableMobileWeek(): boolean {
  if (typeof window === 'undefined') return false;
  const narrowViewport = window.innerWidth < 768;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const shortDeviceSide = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
  return narrowViewport || (coarsePointer && shortDeviceSide <= 900);
}

export function WeekView(p: CalendarViewProps) {
  const {
    weekDays, slotHeight, totalSlots, currentTime,
    isToday, getOccasionsForDay, getAllDayEventsForDay, fetchAllDayEvents, isInAllDayDragRange,
    getMeetings, setSelectedJy, setSelectedJm, setSelectedJd, setViewMode,
    allDayDragging, allDayDragStart, allDayDragEnd,
    setAllDayDragStart, setAllDayDragEnd, setAllDayDragging,
    setAllDayFormDate, setAllDayFormEndDate, setShowAllDayForm,
    timeGridRef, timeScrollRef, weekGridRef,
    handleGridMouseDown, handleGridMouseMove, commitDrag,
    handleGridTouchStart, handleGridTouchMove,
    handleHourColTouchStart, handleHourColTouchMove, handleHourColTouchEnd,
    adjustSlotHeight,
    isDragging, dragStartSlot, dragEndSlot, dragDate, dragMoveMeeting,
    dragMoveCurrentDeltaDay,
  } = p;

  const { offHoursWrapStyle, offHoursInnerStyle } = getOffHoursStyles(p);
  const scrollableMobileWeek = shouldUseScrollableMobileWeek();

  return (
    <div className="mx-2 mb-2 mt-1 flex flex-1 min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-none sm:mx-3 sm:mb-3">
      <div
        className="flex min-h-0 flex-1 overflow-auto overscroll-contain"
        ref={el => { (timeGridRef as any).current = el; (timeScrollRef as any).current = el; }}
      >
        <div
          className="flex min-h-0 flex-1 flex-col"
          style={{ minWidth: scrollableMobileWeek ? '720px' : '0px' }}
        >
          <div className="sticky top-0 z-50 flex-shrink-0 border-b border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-950">
            <div className="grid grid-cols-[56px_repeat(7,1fr)] bg-white dark:bg-slate-950">
              <div
                className="sticky z-40 border-l border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-950"
                style={{ insetInlineStart: 0 }}
              />
              {weekDays.map(d => {
                const hasHol = getOccasionsForDay(d.jy, d.jm, d.jd).some((o: any) => o.is_holiday);
                return (
                  <div key={d.weekday} className={`border-r border-slate-100 py-1.5 text-center dark:border-slate-800 sm:py-2 ${(d.weekday === 6 || hasHol) ? 'text-rose-500 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>
                    <div className="text-[10px] sm:text-[11px]">{JALAALI_WEEKDAYS[d.weekday]}</div>
                    <div
                      className={`mt-0.5 inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-sm font-bold transition-colors sm:h-8 sm:w-8 sm:text-base ${isToday(d.jy, d.jm, d.jd)
                        ? 'bg-violet-600 text-white shadow-sm dark:bg-violet-500'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800'}`}
                      onClick={() => { setSelectedJy(d.jy); setSelectedJm(d.jm); setSelectedJd(d.jd); setViewMode('day'); }}
                    >
                      {d.jd}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-[56px_repeat(7,1fr)] border-t border-slate-100 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/60">
              <div
                className="sticky z-40 flex items-center justify-center border-l border-slate-100 bg-slate-50/95 dark:border-slate-800 dark:bg-slate-900"
                style={{ insetInlineStart: 0 }}
              >
                <span className="px-1 text-center text-[9px] leading-tight text-slate-400">کل<br/>روز</span>
              </div>
              {weekDays.map(d => {
                const occ = getOccasionsForDay(d.jy, d.jm, d.jd);
                const dayEvs = getAllDayEventsForDay(d.jy, d.jm, d.jd);
                const isDragHighlight = isInAllDayDragRange(d.jy, d.jm, d.jd);
                return (
                  <div
                    key={d.weekday}
                    className={`group/allday min-h-[24px] min-w-0 cursor-pointer select-none space-y-0.5 overflow-hidden border-r border-slate-100 px-0.5 py-0.5 transition-colors dark:border-slate-800 ${isDragHighlight ? 'bg-violet-50 dark:bg-violet-500/10' : ''}`}
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
                      <div key={o.id} title={o.title} className={`block w-full min-w-0 max-w-full truncate px-0.5 py-0.5 text-[9px] leading-tight ${o.is_holiday
                        ? 'text-rose-700 dark:text-rose-300'
                        : o.is_celebration
                          ? 'text-amber-700 dark:text-amber-300'
                          : 'text-slate-600 dark:text-slate-400'}`}>{o.title}</div>
                    ))}
                    {dayEvs.map((ev: any) => (
                      <div key={ev.id} className={`flex items-center gap-0.5 truncate rounded px-1 py-0.5 text-[9px] leading-tight ${ev.type === 'leave'
                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300'
                        : ev.type === 'meeting'
                          ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300'
                          : 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                        <span className="truncate">{ev.title}</span>
                        <button type="button" onClick={async e => { e.stopPropagation(); await supabase.from('all_day_events').delete().eq('id', ev.id); fetchAllDayEvents(); }} className="flex-shrink-0 hover:opacity-70">
                          <X className="h-2 w-2" />
                        </button>
                      </div>
                    ))}
                    {!isDragHighlight && (
                      <div className="w-full py-0.5 text-center text-[9px] leading-tight text-violet-300 opacity-0 transition-opacity group-hover/allday:opacity-100 dark:text-violet-500">+</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex-1">
            <div style={offHoursWrapStyle}>
              <div className="relative grid grid-cols-[56px_repeat(7,1fr)] bg-white dark:bg-slate-950" ref={weekGridRef} style={offHoursInnerStyle}>
                {(() => {
                  if (!weekDays.some(d => isToday(d.jy, d.jm, d.jd))) return null;
                  const todayIdx = weekDays.findIndex(d => isToday(d.jy, d.jm, d.jd));
                  const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
                  const top = ((nowMin - HOURS_START * 60) / 30) * slotHeight;
                  const timeLabel = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
                  const colRight = `calc(56px + ${todayIdx} * (100% - 56px) / 7)`;
                  const colWidth = `calc((100% - 56px) / 7)`;
                  return (
                    <div className="pointer-events-none absolute z-30" style={{ top: `${top}px`, left: 0, right: 0 }}>
                      <div className="absolute h-px bg-rose-300/40 dark:bg-rose-700/30" style={{ left: 0, right: '56px' }} />
                      <div className="absolute h-px bg-rose-500" style={{ right: colRight, width: colWidth }} />
                      <div className="absolute h-2 w-2 -translate-y-[3px] rounded-full bg-rose-500" style={{ right: `calc(56px + ${todayIdx + 1} * (100% - 56px) / 7 - 4px)` }} />
                    </div>
                  );
                })()}

                <div
                  className="sticky z-40 min-w-[56px] max-w-[56px] border-l border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-950"
                  style={{ insetInlineStart: 0, width: '56px' }}
                  onWheel={e => { if (e.ctrlKey || e.altKey) { e.preventDefault(); adjustSlotHeight(e.deltaY < 0 ? 4 : -4); } }}
                  onTouchStart={handleHourColTouchStart}
                  onTouchMove={handleHourColTouchMove}
                  onTouchEnd={handleHourColTouchEnd}
                >
                  {weekDays.some(d => isToday(d.jy, d.jm, d.jd)) && (() => {
                    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
                    const top = ((nowMin - HOURS_START * 60) / 30) * slotHeight;
                    const timeLabel = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
                    return (
                      <span
                        className="pointer-events-none absolute right-1 z-50 -translate-y-1/2 rounded bg-white/95 px-0.5 text-[9px] font-bold leading-none text-rose-500 dark:bg-slate-950/95"
                        style={{ top: `${top}px` }}
                      >
                        {timeLabel}
                      </span>
                    );
                  })()}
                  {Array.from({ length: HOURS_END - HOURS_START }, (_, i) => i + HOURS_START).map(h => (
                    <div key={h} style={{ height: `${slotHeight * 2}px` }} className="relative">
                      {h > 0 && <span className="absolute -top-2.5 right-1 text-[10px] text-slate-400">{String(h).padStart(2, '0')}:00</span>}
                    </div>
                  ))}
                </div>

                {weekDays.map((d, colIdx) => {
                  const dm = getMeetings(d.jy, d.jm, d.jd);
                  return (
                    <div
                      key={d.weekday}
                      className={`relative select-none touch-none border-r border-slate-100 dark:border-slate-800 ${isToday(d.jy, d.jm, d.jd) ? 'bg-violet-50/25 dark:bg-violet-500/[0.035]' : ''}`}
                      onMouseDown={e => handleGridMouseDown(e, d.jy, d.jm, d.jd)}
                      onMouseMove={handleGridMouseMove}
                      onMouseUp={commitDrag}
                      onMouseLeave={() => { if (isDragging && !dragMoveMeeting) commitDrag(); }}
                      onTouchStart={e => { if (e.touches.length === 2) { handleHourColTouchStart(e); } else { handleGridTouchStart(e, d.jy, d.jm, d.jd); } }}
                      onTouchMove={e => { if (e.touches.length === 2) { handleHourColTouchMove(e); } else { handleGridTouchMove(e); } }}
                      onTouchEnd={() => { handleHourColTouchEnd(); commitDrag(); }}
                    >
                      {renderSlotLines(totalSlots, slotHeight, p.hideOffHours, p.workStartMin, p.workEndMin)}
                      {renderMeetingsWithOverlap(p, dm.filter(m => {
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
                        const s = Math.min(dragStartSlot, dragEndSlot);
                        const e = Math.max(dragStartSlot, dragEndSlot) + 1;
                        return <div className="pointer-events-none absolute left-0.5 right-0.5 z-5 rounded-md border border-violet-500 bg-violet-500/15" style={{ top: `${s * slotHeight}px`, height: `${(e - s) * slotHeight}px` }} />;
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
