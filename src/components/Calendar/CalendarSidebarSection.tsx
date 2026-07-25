import { ChevronRight } from 'lucide-react';
import { CalendarSidebar } from './CalendarSidebar';
import type { MeetingData, CalendarEntry } from './types';

function CalendarSidebarSection({
  showDesktopSidebar, showMobileSidebar,
  sidebarJy, sidebarJm, sidebarMonthDays,
  isToday, isSelected, getMeetingsForDay,
  calendars, subscribedCalendars, enabledCalendarIds,
  occasionsEnabled,
  myGroupOpen, sharedGroupOpen, publicGroupOpen,
  showOnlyMine,
  onToggleMobileSidebar,
  onToggleCalendar,
  onToggleOccasions,
  onMyGroupToggle, onSharedGroupToggle, onPublicGroupToggle,
  onShowOnlyMineChange,
  onSidebarPrev, onSidebarNext, onSidebarMonthClick,
  onDayClick, onDayClickMobile,
  onNewCalendar, onNewCalendarMobile,
  onOpenCalendarList, onOpenCalendarListMobile,
  onShareCalendar, onShareCalendarMobile,
  onEditCalendar, onEditCalendarMobile,
  onDeleteCalendar, onDeleteCalendarMobile,
}: {
  showDesktopSidebar: boolean;
  showMobileSidebar: boolean;
  sidebarJy: number;
  sidebarJm: number;
  sidebarMonthDays: (number | null)[];
  isToday: (jy: number, jm: number, jd: number) => boolean;
  isSelected: (jy: number, jm: number, jd: number) => boolean;
  getMeetingsForDay: (jy: number, jm: number, jd: number) => MeetingData[];
  calendars: CalendarEntry[];
  subscribedCalendars: CalendarEntry[];
  enabledCalendarIds: Set<string>;
  occasionsEnabled: boolean;
  myGroupOpen: boolean;
  sharedGroupOpen: boolean;
  publicGroupOpen: boolean;
  showOnlyMine: boolean;
  onToggleMobileSidebar: () => void;
  onToggleCalendar: (id: string) => void;
  onToggleOccasions: () => void;
  onMyGroupToggle: () => void;
  onSharedGroupToggle: () => void;
  onPublicGroupToggle: () => void;
  onShowOnlyMineChange: (v: boolean) => void;
  onSidebarPrev: () => void;
  onSidebarNext: () => void;
  onSidebarMonthClick: () => void;
  onDayClick: (day: number) => void;
  onDayClickMobile: (day: number) => void;
  onNewCalendar: () => void;
  onNewCalendarMobile: () => void;
  onOpenCalendarList: () => void;
  onOpenCalendarListMobile: () => void;
  onShareCalendar: (cal: CalendarEntry) => void;
  onShareCalendarMobile: (cal: CalendarEntry) => void;
  onEditCalendar: (cal: CalendarEntry) => void;
  onEditCalendarMobile: (cal: CalendarEntry) => void;
  onDeleteCalendar: (id: string) => void;
  onDeleteCalendarMobile: (id: string) => void;
}) {
  const sidebarProps = {
    sidebarJy, sidebarJm, sidebarMonthDays,
    onSidebarPrev, onSidebarNext, onSidebarMonthClick,
    isToday, isSelected, getMeetingsForDay,
    calendars, subscribedCalendars, enabledCalendarIds,
    onToggleCalendar, occasionsEnabled, onToggleOccasions,
    myGroupOpen, sharedGroupOpen, publicGroupOpen,
    onMyGroupToggle, onSharedGroupToggle, onPublicGroupToggle,
    showOnlyMine, onShowOnlyMineChange,
    onNewCalendar, onOpenCalendarList, onShareCalendar, onEditCalendar, onDeleteCalendar,
  };

  return (
    <>
      {/* Desktop sidebar */}
      <div className={`hidden lg:block flex-shrink-0 transition-all duration-300 overflow-hidden ${showDesktopSidebar ? 'w-64 opacity-100' : 'w-0 opacity-0'}`}>
        <div className="w-64 h-full">
          <CalendarSidebar
            {...sidebarProps}
            onDayClick={onDayClick}
          />
        </div>
      </div>

      {/* Mobile sidebar drawer */}
      {showMobileSidebar && (
        <div className="fixed inset-0 z-50 lg:hidden" dir="rtl">
          <div className="absolute inset-0 bg-black/50" onClick={onToggleMobileSidebar} />
          <div className="absolute inset-y-0 right-0 w-72 bg-white dark:bg-gray-900 shadow-2xl flex flex-col animate-slideInRight" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
              <span className="text-sm font-bold dark:text-white">تقویم‌ها</span>
              <button onClick={onToggleMobileSidebar} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg">
                <ChevronRight className="w-5 h-5 dark:text-white" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <CalendarSidebar
                {...sidebarProps}
                onNewCalendar={onNewCalendarMobile}
                onOpenCalendarList={onOpenCalendarListMobile}
                onShareCalendar={onShareCalendarMobile}
                onEditCalendar={onEditCalendarMobile}
                onDeleteCalendar={onDeleteCalendarMobile}
                onSidebarMonthClick={onSidebarMonthClick}
                onDayClick={onDayClickMobile}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { CalendarSidebarSection };
