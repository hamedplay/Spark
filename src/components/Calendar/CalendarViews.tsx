import React from 'react';
import type { CalendarViewProps } from './viewShared';
import { PreviewPopup } from './viewShared';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import { MonthView } from './MonthView';
import { ListView } from './ListView';

export type { CalendarViewProps } from './viewShared';

export function CalendarViews(p: CalendarViewProps) {
  return (
    <>
      <PreviewPopup p={p} />
      {p.viewMode === 'day' && <DayView {...p} />}
      {p.viewMode === 'week' && <WeekView {...p} />}
      {p.viewMode === 'month' && <MonthView {...p} />}
      {(p.viewMode === 'list-week' || p.viewMode === 'list-month') && <ListView {...p} />}
    </>
  );
}
