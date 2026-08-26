import { useEffect } from 'react';
import { CalendarViewProps } from './CalendarViewTypes';
import { renderPreviewPopup } from './CalendarViewShared';
import { DayView } from './DayView';
import { MultiDayView } from './MultiDayView';
import { MonthView } from './MonthView';
import { YearView } from './YearView';
import { ListView } from './ListView';

export type { CalendarViewProps } from './CalendarViewTypes';

export function CalendarViews(p: CalendarViewProps) {
  const { viewMode } = p;
  const multiDay = viewMode === '3-day' || viewMode === '4-day' || viewMode === 'work-week' || viewMode === 'week';

  useEffect(() => {
    const onZoom = (event: Event) => {
      const delta = Number((event as CustomEvent<{ delta?: number }>).detail?.delta || 0);
      if (delta) p.adjustSlotHeight(delta);
    };
    const onDensity = (event: Event) => {
      const target = Number((event as CustomEvent<{ slotHeight?: number }>).detail?.slotHeight || 0);
      if (target > 0 && target !== p.slotHeight) p.adjustSlotHeight(target - p.slotHeight);
    };
    window.addEventListener('spark-calendar-zoom', onZoom as EventListener);
    window.addEventListener('spark-calendar-density', onDensity as EventListener);
    return () => {
      window.removeEventListener('spark-calendar-zoom', onZoom as EventListener);
      window.removeEventListener('spark-calendar-density', onDensity as EventListener);
    };
  }, [p.adjustSlotHeight, p.slotHeight]);

  return (
    <>
      {renderPreviewPopup(p)}
      {viewMode === 'day' && <DayView {...p} />}
      {multiDay && <MultiDayView {...p} />}
      {viewMode === 'month' && <MonthView {...p} />}
      {viewMode === 'year' && <YearView {...p} />}
      {viewMode === 'schedule' && <ListView {...p} />}
    </>
  );
}
