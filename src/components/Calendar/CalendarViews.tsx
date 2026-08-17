import { CalendarViewProps } from './CalendarViewTypes';
import { renderPreviewPopup } from './CalendarViewShared';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import { MonthView } from './MonthView';
import { ListView } from './ListView';

export type { CalendarViewProps } from './CalendarViewTypes';

export function CalendarViews(p: CalendarViewProps) {
  const { viewMode } = p;

  return (
    <>
      {renderPreviewPopup(p)}
      {viewMode === 'day' && <DayView {...p} />}
      {viewMode === 'week' && <WeekView {...p} />}
      {viewMode === 'month' && <MonthView {...p} />}
      {(viewMode === 'list-week' || viewMode === 'list-month') && <ListView {...p} />}
    </>
  );
}
