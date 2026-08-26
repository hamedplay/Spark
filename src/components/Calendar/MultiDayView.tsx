import React, { useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import {
  HOURS_START,
  HOURS_END,
  JALAALI_WEEKDAYS,
  jalaaliToDate,
  toJalaali,
  toFarsiDigits,
  viewDayCount,
  parseRequestDateToDateStr,
  jalaaliToYYYYMMDD,
  minutesToTime,
  timeToMinutes,
} from './utils';
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
  renderSlotLines,
  renderMeetingsWithOverlap,
  getOffHoursStyles,
} from './CalendarViewShared';

function getDays(p: CalendarViewProps) {
  if (p.viewMode === 'week') return p.weekDays;
  if (p.viewMode === 'work-week') return p.weekDays.slice(0, 5);

  const count = viewDayCount(p.viewMode);
  const start = jalaaliToDate(p.selectedJy, p.selectedJm, p.selectedJd);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const j = toJalaali(d);
    const jsDay = d.getDay();
    return { ...j, weekday: jsDay === 6 ? 0 : jsDay + 1 };
  });
}

export function MultiDayView(p: CalendarViewProps) {
  const days = useMemo(
    () => getDays(p),
    [p.viewMode, p.selectedJy, p.selectedJm, p.selectedJd, p.weekDays],
  );
  const dayCount = Math.max(1, days.length);
  const touchGestures = useCalendarTouchGestures(p, false);
  const displayStartHour = p.visibleStartHour;
  const { offHoursWrapStyle, offHoursInnerStyle } = getOffHoursStyles(p);
  const multiDayOffHoursWrapStyle = offHoursWrapStyle
    ? { ...offHoursWrapStyle, overflow: 'clip' as const, display: 'flow-root' as const }
    : undefined;
  const hourColumnWidth = 56;
  const minDayWidth = p.viewMode === 'week' ? 112 : dayCount >= 4 ? 120 : 136;
  const gridTemplateColumns = `${hourColumnWidth}px repeat(${dayCount}, minmax(${minDayWidth}px, 1fr))`;
  const dayGridTemplateColumns = `repeat(${dayCount}, minmax(${minDayWidth}px, 1fr))`;
  const dayGridMinWidth = dayCount * minDayWidth;
  const minWidth = hourColumnWidth + dayGridMinWidth;
  const dragTargetSlot = p.dragMoveMeeting
    ? Math.max(0, Math.min(p.totalSlots, p.dragMoveOriginalSlot + p.dragMoveCurrentDeltaSlot))
    : null;
  const dragTargetTime = dragTargetSlot !== null
    ? toFarsiDigits(minutesToTime(dragTargetSlot * 30))
    : null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const el = p.timeScrollRef.current;
      if (!el) return;
      const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
      const targetSlot = Math.max(nowMinutes, 6 * 60) / 30;
      el.scrollTop = Math.max(0, targetSlot * p.slotHeight - el.clientHeight / 2);
    }, 50);
    return () => window.clearTimeout(timer);
  }, [p.viewMode]);

  const setGridRef = (el: HTMLDivElement | null) => {
    (p.weekGridRef as any).current = el;
    (p.dayGridRef as any).current = el;
  };

  // Keep the currently selected day visible when the calendar opens or refreshes.
  // On narrow/mobile week views this horizontally centers the selected day without
  // disturbing the vertical current-time position.
  useEffect(() => {
    if (!days.length || !p.selectedJy || !p.selectedJm || !p.selectedJd) return;

    const timer = window.setTimeout(() => {
      const scroller = p.timeScrollRef.current;
      if (!scroller) return;

      const target = scroller.querySelector(
        `[data-calendar-day="${p.selectedJy}-${p.selectedJm}-${p.selectedJd}"]`,
      ) as HTMLElement | null;
      if (!target) return;

      const previousScrollTop = scroller.scrollTop;
      target.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
      scroller.scrollTop = previousScrollTop;
    }, 80);

    return () => window.clearTimeout(timer);
  }, [days, p.viewMode, p.selectedJy, p.selectedJm, p.selectedJd]);

  const dropMeetingOnDay = async (
    e: React.MouseEvent,
    day: { jy: number; jm: number; jd: number },
  ) => {
    if (!p.dragMoveMeeting || p.viewMode === 'week') return false;

    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();

    const meeting = p.dragMoveMeeting;
    const originalDate = parseRequestDateToDateStr(meeting.request_date) || '';
    const newDate = jalaaliToYYYYMMDD(day.jy, day.jm, day.jd);
    const startSlot = p.dragMoveOriginalSlot + p.dragMoveCurrentDeltaSlot;
    const endSlot = p.dragMoveOriginalEndSlot + p.dragMoveCurrentDeltaSlot;
    const maxSlots = (HOURS_END - HOURS_START) * 2;

    p.setDragMoveMeeting(null);
    p.setDragMoveCurrentDeltaSlot(0);
    p.setDragMoveCurrentDeltaDay(0);

    if (startSlot < 0 || endSlot > maxSlots) return true;
    if (newDate === originalDate && p.dragMoveCurrentDeltaSlot === 0) return true;

    const startTime = minutesToTime(startSlot * 30);
    const endTime = minutesToTime(endSlot * 30);
    const updates: Record<string, string> = {
      start_time: startTime,
      end_time: endTime,
      duration: `${startTime} - ${endTime}`,
    };
    if (newDate !== originalDate) {
      updates.request_date = new Date(`${newDate}T12:00:00`).toISOString();
    }

    const { error } = await supabase.from('meetings').update(updates).eq('id', meeting.id);
    if (error) toast.error('خطا در جابجایی جلسه');
    else toast.success('جلسه جابجا شد');
    return true;
  };

  const eventRenderProps: CalendarViewProps = dayCount >= 5
    ? ({ ...p, viewMode: 'week' } as CalendarViewProps)
    : p;

  return (
    <div className="mx-2 mb-2 mt-1 flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-none sm:mx-3 sm:mb-3">
      <div
        className="min-h-0 flex-1 overflow-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-x pan-y', scrollbarWidth: 'none' }}
        ref={el => {
          (p.timeGridRef as any).current = el;
          (p.timeScrollRef as any).current = el;
        }}
      >
        <div className="flex min-h-full flex-col" style={{ minWidth, width: '100%' }}>
          <div
            className="sticky top-0 z-40 flex-shrink-0 border-b border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-950"
            style={{ position: 'sticky', top: 0 }}
          >
            <div className="grid" style={{ gridTemplateColumns }}>
              <div
                className="sticky right-0 z-20 w-14 min-w-14 max-w-14 border-l border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-950"
                style={{ position: 'sticky', right: 0 }}
              />
              {days.map(d => {
                const holiday = getDayHoliday(p, d);
                return (
                  <div
                    key={`header-${d.jy}-${d.jm}-${d.jd}`}
                    data-calendar-day={`${d.jy}-${d.jm}-${d.jd}`}
                    className={`border-r-2 border-slate-300/90 py-1.5 text-center dark:border-slate-600/90 sm:py-2 ${p.isToday(d.jy, d.jm, d.jd)
                      ? 'bg-violet-50/45 dark:bg-violet-500/[0.06]'
                      : d.weekday % 2 === 0
                        ? 'bg-sky-100/65 dark:bg-sky-500/[0.08]'
                        : 'bg-white dark:bg-slate-950'} ${holiday ? 'text-rose-500 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    <div className="text-[10px] sm:text-[11px]">{JALAALI_WEEKDAYS[d.weekday]}</div>
                    <button
                      type="button"
                      className={`mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors ${p.isToday(d.jy, d.jm, d.jd)
                        ? 'bg-violet-600 text-white shadow-sm dark:bg-violet-500'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800'}`}
                      onClick={() => {
                        p.setSelectedJy(d.jy);
                        p.setSelectedJm(d.jm);
                        p.setSelectedJd(d.jd);
                        p.setViewMode('day');
                      }}
                    >
                      {toFarsiDigits(d.jd)}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="grid border-t border-slate-200/90 bg-slate-50/70 dark:border-slate-700/80 dark:bg-slate-900/60" style={{ gridTemplateColumns }}>
              <div className="sticky right-0 z-20 flex w-14 min-w-14 max-w-14 items-center justify-center border-l border-slate-200/80 bg-slate-50/95 shadow-[-6px_0_10px_-10px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-900/95" style={{ position: 'sticky', right: 0 }}>
                <span className="px-1 text-center text-[9px] font-semibold leading-tight text-slate-500 dark:text-slate-400">مناسبت‌ها</span>
              </div>
              {days.map(d => {
                const occ = p.getOccasionsForDay(d.jy, d.jm, d.jd);
                const dayEvents = p.getAllDayEventsForDay(d.jy, d.jm, d.jd);
                const highlighted = p.isInAllDayDragRange(d.jy, d.jm, d.jd);
                return (
                  <div
                    key={`occasions-${d.jy}-${d.jm}-${d.jd}`}
                    className={`group/allday min-h-[28px] min-w-0 cursor-pointer select-none space-y-0.5 overflow-hidden border-r-2 border-slate-300/90 px-0.5 py-0.5 transition-colors dark:border-slate-600/90 ${highlighted ? 'bg-violet-50 dark:bg-violet-500/10' : p.isToday(d.jy, d.jm, d.jd) ? 'bg-violet-50/35 dark:bg-violet-500/[0.05]' : d.weekday % 2 === 0 ? 'bg-sky-100/65 dark:bg-sky-500/[0.08]' : 'bg-slate-50/70 dark:bg-slate-900/60'}`}
                    onMouseDown={e => { e.preventDefault(); p.setAllDayDragStart({ jy: d.jy, jm: d.jm, jd: d.jd }); p.setAllDayDragEnd({ jy: d.jy, jm: d.jm, jd: d.jd }); p.setAllDayDragging(true); }}
                    onMouseEnter={() => { if (p.allDayDragging) p.setAllDayDragEnd({ jy: d.jy, jm: d.jm, jd: d.jd }); }}
                    onMouseUp={() => {
                      if (!p.allDayDragging || !p.allDayDragStart) return;
                      const rangeEnd = p.allDayDragEnd || p.allDayDragStart;
                      p.setAllDayFormDate(p.allDayDragStart);
                      p.setAllDayFormEndDate(rangeEnd);
                      p.setShowAllDayForm(true);
                      p.setAllDayDragging(false);
                      p.setAllDayDragStart(null);
                      p.setAllDayDragEnd(null);
                    }}
                  >
                    {occ.slice(0, 1).map((o: any) => (
                      <div key={o.id} title={o.title} className={`truncate px-0.5 text-[9px] ${o.is_holiday ? 'text-rose-700 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'}`}>{o.title}</div>
                    ))}
                    {dayEvents.slice(0, 2).map((ev: any) => (
                      <div key={ev.id} className={`flex items-center gap-0.5 truncate rounded px-1 py-0.5 text-[9px] ${ev.type === 'leave' ? 'bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300' : 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300'}`}>
                        <span className="truncate">{ev.title}</span>
                        <button type="button" onMouseDown={e => e.stopPropagation()} onClick={async e => { e.stopPropagation(); await supabase.from('all_day_events').delete().eq('id', ev.id); p.fetchAllDayEvents(); }} className="flex-shrink-0 hover:opacity-70"><X className="h-2 w-2" /></button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            <div className="grid border-t border-slate-300/90 bg-white dark:border-slate-600/90 dark:bg-slate-950" style={{ gridTemplateColumns }}>
              <div className="sticky right-0 z-20 flex w-14 min-w-14 max-w-14 items-center justify-center border-l border-slate-200/80 bg-white shadow-[-6px_0_10px_-10px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-950" style={{ position: 'sticky', right: 0 }}>
                <span className="px-1 text-center text-[9px] font-semibold leading-tight text-slate-500 dark:text-slate-400">مجموع<br />زمان</span>
              </div>
              {days.map(d => {
                const meetingDuration = formatMeetingDuration(getMeetingTotalMinutes(p.getMeetings(d.jy, d.jm, d.jd)));
                return (
                  <div key={`duration-${d.jy}-${d.jm}-${d.jd}`} className={`flex min-h-[28px] min-w-0 items-center justify-center border-r-2 border-slate-300/90 px-1 py-1 text-center dark:border-slate-600/90 ${p.isToday(d.jy, d.jm, d.jd) ? 'bg-violet-50/25 dark:bg-violet-500/[0.035]' : d.weekday % 2 === 0 ? 'bg-sky-100/65 dark:bg-sky-500/[0.08]' : 'bg-white dark:bg-slate-950'}`}>
                    <span className="text-[10px] font-bold leading-tight text-slate-600 dark:text-slate-300">{meetingDuration}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex-none">
            <div style={multiDayOffHoursWrapStyle}>
              <div
                className="relative flex overflow-hidden bg-white dark:bg-slate-950"
                ref={setGridRef}
                style={offHoursInnerStyle}
              >
                <div
                  className="sticky right-0 z-20 w-14 min-w-14 max-w-14 flex-shrink-0 overflow-hidden border-l border-slate-200/80 bg-white shadow-[-6px_0_10px_-10px_rgba(15,23,42,0.35)] dark:border-slate-800 dark:bg-slate-950"
                  style={{
                    position: 'sticky',
                    right: 0,
                    height: `${(HOURS_END - HOURS_START) * p.slotHeight * 2}px`,
                  }}
                  onWheel={e => {
                    if (e.ctrlKey || e.altKey) {
                      e.preventDefault();
                      p.adjustSlotHeight(e.deltaY < 0 ? 4 : -4);
                    }
                  }}
                  onTouchStart={p.handleHourColTouchStart}
                  onTouchMove={p.handleHourColTouchMove}
                  onTouchEnd={p.handleHourColTouchEnd}
                >
                  {Array.from({ length: HOURS_END - HOURS_START - 1 }, (_, i) => i + HOURS_START + 1).map(h => (
                    <span
                      key={h}
                      className="pointer-events-none absolute left-0 right-0 whitespace-nowrap text-center text-[10px] font-medium text-slate-500 dark:text-slate-400"
                      style={{
                        top: `${(h - HOURS_START) * p.slotHeight * 2}px`,
                        transform: p.hideOffHours && h === displayStartHour ? 'translateY(2px)' : 'translateY(-50%)',
                      }}
                    >
                      {toFarsiDigits(String(h).padStart(2, '0') + ':00')}
                    </span>
                  ))}
                  {renderCurrentTimeRailLabel(p, days)}
                  {dragTargetSlot !== null && dragTargetTime && (
                    <div
                      className="pointer-events-none absolute left-1 right-1 z-40 -translate-y-1/2 rounded-full bg-rose-500 px-1 py-0.5 text-center text-[9px] font-bold leading-none text-white shadow-sm"
                      style={{ top: `${dragTargetSlot * p.slotHeight}px` }}
                    >
                      {dragTargetTime}
                    </div>
                  )}
                </div>

                <div
                  className="relative grid flex-1 overflow-hidden bg-white dark:bg-slate-950"
                  style={{ gridTemplateColumns: dayGridTemplateColumns, minWidth: dayGridMinWidth }}
                >
                  {renderCurrentTime(p, days, dayCount)}
                  {dragTargetSlot !== null && (
                    <div
                      className="pointer-events-none absolute left-0 right-0 z-30"
                      style={{ top: `${dragTargetSlot * p.slotHeight}px` }}
                    >
                      <div className="h-0.5 w-full bg-rose-500 shadow-[0_0_0_1px_rgba(244,63,94,0.08)]" />
                    </div>
                  )}

                  {days.map((d, colIdx) => {
                    const meetings = p.getMeetings(d.jy, d.jm, d.jd);
                    return (
                      <div
                        key={`grid-${d.jy}-${d.jm}-${d.jd}`}
                        className={`relative select-none border-r-2 border-slate-300/90 dark:border-slate-600/90 ${p.isToday(d.jy, d.jm, d.jd)
                          ? 'bg-violet-50/25 dark:bg-violet-500/[0.035]'
                          : d.weekday % 2 === 0
                            ? 'bg-sky-100/65 dark:bg-sky-500/[0.08]'
                            : 'bg-white dark:bg-slate-950'}`}
                        style={{ touchAction: 'pan-x pan-y' }}
                        onMouseDown={e => { e.preventDefault(); p.handleGridMouseDown(e, d.jy, d.jm, d.jd); }}
                        onMouseMove={e => { if (p.isDragging) e.preventDefault(); p.handleGridMouseMove(e); }}
                        onMouseUp={async e => {
                          if (await dropMeetingOnDay(e, d)) return;
                          p.commitDrag();
                        }}
                        onMouseLeave={() => {
                          if (p.isDragging && !p.dragMoveMeeting) p.commitDrag();
                        }}
                        onTouchStart={e => touchGestures.handleTouchStart(e, d)}
                        onTouchMove={touchGestures.handleTouchMove}
                        onTouchEnd={touchGestures.handleTouchEnd}
                        onTouchCancel={touchGestures.handleTouchCancel}
                      >
                        {renderSlotLines(p.totalSlots, p.slotHeight, p.hideOffHours, p.workStartMin, p.workEndMin)}
                        {renderMeetingsWithOverlap(eventRenderProps, meetings.filter(m => {
                          if (p.dragMoveMeeting?.id !== m.id) return true;
                          const originalDate = parseRequestDateToDateStr(m.request_date) || '';
                          const originalCol = days.findIndex(day => jalaaliToYYYYMMDD(day.jy, day.jm, day.jd) === originalDate);
                          const targetCol = Math.max(0, Math.min(dayCount - 1, originalCol + p.dragMoveCurrentDeltaDay));
                          return originalCol === colIdx || targetCol === colIdx;
                        }), dayCount)}
                        {p.isDragging && p.dragStartSlot !== null && p.dragEndSlot !== null && p.dragDate && p.dragDate.jy === d.jy && p.dragDate.jm === d.jm && p.dragDate.jd === d.jd && (() => {
                          const start = Math.min(p.dragStartSlot!, p.dragEndSlot!);
                          const end = Math.max(p.dragStartSlot!, p.dragEndSlot!) + 1;
                          return (
                            <div
                              className="pointer-events-none absolute left-0.5 right-0.5 z-20 rounded-md border border-violet-500 bg-violet-500/15"
                              style={{ top: `${start * p.slotHeight}px`, height: `${(end - start) * p.slotHeight}px` }}
                            />
                          );
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
    </div>
  );
}

function getDayHoliday(p: CalendarViewProps, d: { jy: number; jm: number; jd: number; weekday: number }) {
  return d.weekday === 6 || p.getOccasionsForDay(d.jy, d.jm, d.jd).some((o: any) => o.is_holiday);
}

function renderCurrentTime(
  p: CalendarViewProps,
  days: Array<{ jy: number; jm: number; jd: number; weekday: number }>,
  dayCount: number,
) {
  const todayIndex = days.findIndex(d => p.isToday(d.jy, d.jm, d.jd));
  if (todayIndex < 0) return null;

  const nowMin = p.currentTime.getHours() * 60 + p.currentTime.getMinutes();
  const top = (nowMin / 30) * p.slotHeight;
  const colRight = `calc(${todayIndex} * 100% / ${dayCount})`;
  const colWidth = `calc(100% / ${dayCount})`;

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-20"
      style={{ top: `${top}px` }}
      aria-hidden="true"
    >
      <div className="absolute left-0 right-0 h-[2px] -translate-y-1/2 bg-rose-400/55 shadow-[0_0_6px_rgba(244,63,94,0.24)] dark:bg-rose-500/45" />
      <div
        className="absolute h-[3px] -translate-y-1/2 bg-rose-500 shadow-[0_0_0_1px_rgba(255,255,255,0.8),0_0_10px_rgba(244,63,94,0.55)] dark:bg-rose-400 dark:shadow-[0_0_0_1px_rgba(15,23,42,0.85),0_0_10px_rgba(251,113,133,0.6)]"
        style={{ right: colRight, width: colWidth }}
      />
      <div
        className="absolute h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-rose-500 shadow-[0_0_0_1px_rgba(244,63,94,0.28),0_0_10px_rgba(244,63,94,0.6)] dark:border-slate-950 dark:bg-rose-400"
        style={{ right: `calc(${todayIndex + 1} * 100% / ${dayCount} - 6px)` }}
      />
    </div>
  );
}

function renderCurrentTimeRailLabel(
  p: CalendarViewProps,
  days: Array<{ jy: number; jm: number; jd: number; weekday: number }>,
) {
  if (!days.some(d => p.isToday(d.jy, d.jm, d.jd))) return null;
  const nowMin = p.currentTime.getHours() * 60 + p.currentTime.getMinutes();
  const top = (nowMin / 30) * p.slotHeight;
  const label = toFarsiDigits(`${String(p.currentTime.getHours()).padStart(2, '0')}:${String(p.currentTime.getMinutes()).padStart(2, '0')}`);

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-20 -translate-y-1/2 whitespace-nowrap text-center text-[9px] font-bold leading-none text-rose-500"
      style={{ top: `${top}px` }}
    >
      {label}
    </div>
  );
}
