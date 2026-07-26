import { ChevronRight } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  jalaaliDatesBetween,
} from './utils';
import { CalendarSidebar } from './CalendarSidebar';
import type { CalendarEntry } from './types';

export interface MobileSidebarDrawerProps {
  sidebarJy: number;
  sidebarJm: number;
  sidebarMonthDays: Array<number | null>;
  isToday: (jy: number, jm: number, jd: number) => boolean;
  isSelected: (jy: number, jm: number, jd: number) => boolean;
  getMeetingsForDay: (jy: number, jm: number, jd: number) => any[];
  calendars: CalendarEntry[];
  subscribedCalendars: CalendarEntry[];
  enabledCalendarIds: Set<string>;
  occasionsEnabled: boolean;
  onToggleOccasions: () => void;
  myGroupOpen: boolean;
  sharedGroupOpen: boolean;
  publicGroupOpen: boolean;
  showOnlyMine: boolean;
  onSidebarPrev: () => void;
  onSidebarNext: () => void;
  onSidebarMonthClick: () => void;
  onDayClick: (day: number) => void;
  onToggleCalendar: (id: string) => void;
  onMyGroupToggle: () => void;
  onSharedGroupToggle: () => void;
  onPublicGroupToggle: () => void;
  onShowOnlyMineChange: (v: boolean) => void;
  onNewCalendar: () => void;
  onOpenCalendarList: () => void;
  onShareCalendar: (cal: CalendarEntry) => void;
  onEditCalendar: (cal: CalendarEntry) => void;
  onDeleteCalendar: (id: string) => void;
  onClose: () => void;
}

export function MobileSidebarDrawer(p: MobileSidebarDrawerProps) {
  return (
    <div className="fixed inset-0 z-50 lg:hidden" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={p.onClose} />
      <div className="absolute inset-y-0 right-0 w-72 bg-white dark:bg-gray-900 shadow-2xl flex flex-col animate-slideInRight" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <span className="text-sm font-bold dark:text-white">تقویم‌ها</span>
          <button onClick={p.onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
            <ChevronRight className="w-5 h-5 dark:text-white" />
          </button>
        </div>
        <div className="flex-1 overflow-hidden">
          <CalendarSidebar
            sidebarJy={p.sidebarJy}
            sidebarJm={p.sidebarJm}
            sidebarMonthDays={p.sidebarMonthDays}
            onSidebarPrev={p.onSidebarPrev}
            onSidebarNext={p.onSidebarNext}
            onSidebarMonthClick={p.onSidebarMonthClick}
            onDayClick={p.onDayClick}
            isToday={p.isToday}
            isSelected={p.isSelected}
            getMeetingsForDay={p.getMeetingsForDay}
            calendars={p.calendars}
            subscribedCalendars={p.subscribedCalendars}
            enabledCalendarIds={p.enabledCalendarIds}
            onToggleCalendar={p.onToggleCalendar}
            occasionsEnabled={p.occasionsEnabled}
            onToggleOccasions={p.onToggleOccasions}
            myGroupOpen={p.myGroupOpen}
            sharedGroupOpen={p.sharedGroupOpen}
            publicGroupOpen={p.publicGroupOpen}
            onMyGroupToggle={p.onMyGroupToggle}
            onSharedGroupToggle={p.onSharedGroupToggle}
            onPublicGroupToggle={p.onPublicGroupToggle}
            showOnlyMine={p.showOnlyMine}
            onShowOnlyMineChange={p.onShowOnlyMineChange}
            onNewCalendar={p.onNewCalendar}
            onOpenCalendarList={p.onOpenCalendarList}
            onShareCalendar={p.onShareCalendar}
            onEditCalendar={p.onEditCalendar}
            onDeleteCalendar={p.onDeleteCalendar}
          />
        </div>
      </div>
    </div>
  );
}

export { supabase, jalaaliDatesBetween };
