import { useEffect, useState } from 'react';
import { Calendar, PanelRightOpen, PanelRightClose, Search, RefreshCw, ChevronRight, ChevronLeft, ChevronDown, Clock, MapPin } from 'lucide-react';
import { toJalaali } from './utils';
import type { MeetingData } from '../types';

interface ViewOption { key: string; label: string; }

function detectCompactCalendarLayout(): boolean {
  if (typeof window === 'undefined') return false;
  const narrowViewport = window.innerWidth < 640;
  const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const shortDeviceSide = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
  return narrowViewport || (coarsePointer && shortDeviceSide <= 900);
}

export function CalendarToolbar(props: {
  showMobileSidebar: boolean;
  setShowMobileSidebar: React.Dispatch<React.SetStateAction<boolean>>;
  showDesktopSidebar: boolean;
  setShowDesktopSidebar: React.Dispatch<React.SetStateAction<boolean>>;
  goToToday: () => void;
  searchRef: React.RefObject<HTMLDivElement | null>;
  showSearch: boolean;
  setShowSearch: React.Dispatch<React.SetStateAction<boolean>>;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  searchResults: MeetingData[];
  navigateToMeeting: (m: MeetingData) => void;
  parseRequestDateToDateStr: (rd: string) => string | null;
  isRefreshing: boolean;
  fetchMeetings: () => void;
  navigatePrev: () => void;
  navigateNext: () => void;
  getNavTitle: () => string;
  showViewDropdown: boolean;
  setShowViewDropdown: React.Dispatch<React.SetStateAction<boolean>>;
  viewMode: string;
  setViewMode: React.Dispatch<React.SetStateAction<string>>;
  VIEW_OPTIONS: ViewOption[];
  canHideOffHours: boolean;
  prefsHideOffhours: boolean | undefined;
  hideOffHours: boolean;
  setHideOffHours: React.Dispatch<React.SetStateAction<boolean>>;
  updatePrefs: (p: Record<string, unknown>) => void;
}) {
  const {
    showMobileSidebar, setShowMobileSidebar,
    showDesktopSidebar, setShowDesktopSidebar,
    goToToday,
    searchRef,
    showSearch, setShowSearch,
    searchInputRef,
    searchQuery, setSearchQuery,
    searchResults,
    navigateToMeeting,
    parseRequestDateToDateStr,
    isRefreshing,
    fetchMeetings,
    navigatePrev, navigateNext,
    getNavTitle,
    showViewDropdown, setShowViewDropdown,
    viewMode, setViewMode,
    VIEW_OPTIONS,
    canHideOffHours, prefsHideOffhours,
    hideOffHours, setHideOffHours,
    updatePrefs,
  } = props;

  const [compactMobile, setCompactMobile] = useState(detectCompactCalendarLayout);

  useEffect(() => {
    const sync = () => setCompactMobile(detectCompactCalendarLayout());
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, []);

  const iconButton = compactMobile
    ? 'flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border transition-colors'
    : 'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border transition-colors';

  // One control owns the calendar side panel: drawer on mobile, fixed sidebar on desktop.
  const sidebarVisible = compactMobile ? showMobileSidebar : showDesktopSidebar;
  const SidebarToggleIcon = sidebarVisible ? PanelRightClose : PanelRightOpen;
  const calendarSidebarButton = (
    <button
      type="button"
      data-calendar-sidebar-toggle="true"
      onClick={() => {
        if (compactMobile) setShowMobileSidebar(v => !v);
        else setShowDesktopSidebar(v => !v);
      }}
      className={`${iconButton} ${sidebarVisible
        ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-300'
        : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-blue-500/30 dark:hover:bg-blue-500/10 dark:hover:text-blue-300'}`}
      title={sidebarVisible ? 'بستن نوار کناری تقویم' : 'باز کردن نوار کناری تقویم'}
      aria-label={sidebarVisible ? 'بستن نوار کناری تقویم' : 'باز کردن نوار کناری تقویم'}
      aria-pressed={sidebarVisible}
    >
      <SidebarToggleIcon className={compactMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
    </button>
  );

  const todayButton = (
    <button
      onClick={goToToday}
      className={`${compactMobile ? 'h-7 px-2 text-[11px]' : 'h-8 px-3 text-xs'} flex-shrink-0 rounded-lg bg-violet-600 font-bold text-white shadow-sm transition-colors hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400`}
    >
      امروز
    </button>
  );

  const searchControl = (
    <div ref={searchRef} className="relative z-[90] flex-shrink-0">
      <button
        onClick={() => setShowSearch(v => !v)}
        className={`${iconButton} ${showSearch
          ? 'border-cyan-200 bg-cyan-50 text-cyan-600 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300'
          : 'border-slate-200 bg-white text-slate-500 hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-cyan-500/30 dark:hover:bg-cyan-500/10 dark:hover:text-cyan-300'}`}
        title="جستجوی جلسات"
        aria-label="جستجوی جلسات"
      >
        <Search className={compactMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </button>

      {showSearch && (
        <div className="absolute right-0 top-full z-[110] mt-1.5 w-[min(18rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.16)] dark:border-slate-700 dark:bg-slate-900" dir="rtl">
          <div className="border-b border-slate-100 p-2 dark:border-slate-800">
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="جستجوی موضوع، محل یا نماینده..."
                dir="rtl"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-3 pr-8 text-xs text-slate-800 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500"
              />
            </div>
          </div>

          {searchResults.length > 0 ? (
            <div className="max-h-64 overflow-y-auto py-1">
              {searchResults.map(m => {
                const dateStr = parseRequestDateToDateStr(m.request_date);
                const j = dateStr ? toJalaali(new Date(dateStr + 'T12:00:00')) : null;
                return (
                  <button
                    key={m.id}
                    onClick={() => navigateToMeeting(m)}
                    className="flex w-full items-start gap-2.5 px-3 py-2 text-right transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-500/10">
                      <Calendar className="h-3.5 w-3.5 text-violet-600 dark:text-violet-300" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-bold text-slate-800 dark:text-white">{m.subject}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
                        {j && <span>{j.jy}/{String(j.jm).padStart(2,'0')}/{String(j.jd).padStart(2,'0')}</span>}
                        {m.start_time && <span className="text-cyan-600 dark:text-cyan-300">{m.start_time}</span>}
                        {m.location && <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" />{m.location}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : searchQuery.trim() ? (
            <div className="py-6 text-center text-xs text-slate-400">جلسه‌ای یافت نشد</div>
          ) : (
            <div className="py-4 text-center text-[11px] text-slate-400">برای جستجو عبارت موردنظر را وارد کنید</div>
          )}
        </div>
      )}
    </div>
  );

  const refreshButton = (
    <button
      onClick={() => fetchMeetings()}
      disabled={isRefreshing}
      className={`${iconButton} border-slate-200 bg-white text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-emerald-300 dark:hover:border-emerald-500/30 dark:hover:bg-emerald-500/10`}
      title="بروزرسانی"
      aria-label="بروزرسانی تقویم"
    >
      <RefreshCw className={`${compactMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${isRefreshing ? 'animate-spin' : ''}`} />
    </button>
  );

  const navigationControl = (
    <div className="flex flex-shrink-0 items-center rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
      <button onClick={navigatePrev} className={`${compactMobile ? 'h-6 w-6' : 'h-7 w-7'} flex items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800`} title="قبلی" aria-label="بازه قبلی">
        <ChevronRight className={compactMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </button>
      <button onClick={navigateNext} className={`${compactMobile ? 'h-6 w-6' : 'h-7 w-7'} flex items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800`} title="بعدی" aria-label="بازه بعدی">
        <ChevronLeft className={compactMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </button>
    </div>
  );

  const viewControl = (
    <div className="relative z-[100] flex-shrink-0">
      <button
        onClick={() => setShowViewDropdown(o => !o)}
        className={`${compactMobile ? 'h-7 min-w-[68px] px-2 text-[11px]' : 'h-8 min-w-[86px] px-2.5 text-xs'} flex items-center justify-between gap-1 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 transition-colors hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300 dark:hover:bg-indigo-500/15`}
      >
        <span>{VIEW_OPTIONS.find(v => v.key === viewMode)?.label || 'روز'}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {showViewDropdown && (
        <div className="absolute left-0 top-full z-[120] mt-1 min-w-[150px] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-[0_14px_40px_rgba(15,23,42,0.18)] dark:border-slate-700 dark:bg-slate-900">
          {VIEW_OPTIONS.map(v => (
            <button
              key={v.key}
              onClick={() => { setViewMode(v.key); setShowViewDropdown(false); }}
              className={`flex w-full items-center gap-2 px-3 py-2 text-right text-xs transition-colors hover:bg-slate-50 dark:hover:bg-slate-800 ${viewMode === v.key ? 'font-bold text-indigo-600 dark:text-indigo-300' : 'text-slate-700 dark:text-slate-200'}`}
            >
              <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${viewMode === v.key ? 'bg-indigo-500' : 'bg-transparent'}`} />
              {v.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const offHoursControl = (canHideOffHours || prefsHideOffhours !== undefined) ? (
    <button
      onClick={() => { const next = !hideOffHours; setHideOffHours(next); updatePrefs({ hide_offhours: next }); }}
      title={hideOffHours ? 'نمایش ساعات غیرکاری' : 'پنهان کردن ساعات غیرکاری'}
      aria-label={hideOffHours ? 'نمایش ساعات غیرکاری' : 'پنهان کردن ساعات غیرکاری'}
      className={`${iconButton} ${hideOffHours
        ? 'border-amber-200 bg-amber-50 text-amber-600 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
        : 'border-slate-200 bg-white text-slate-500 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-amber-500/30 dark:hover:bg-amber-500/10 dark:hover:text-amber-300'}`}
    >
      <Clock className={compactMobile ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
    </button>
  ) : null;

  return (
    <div className={`relative ${compactMobile && showMobileSidebar ? 'z-20' : 'z-50'} flex min-h-[42px] flex-shrink-0 items-center overflow-visible border-b border-slate-200/80 bg-white/95 shadow-[0_1px_0_rgba(15,23,42,0.02)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/95 ${compactMobile ? 'gap-1 px-1.5 py-1.5' : 'gap-1.5 px-3 py-1.5'}`}>
      {calendarSidebarButton}
      {todayButton}
      {searchControl}
      {refreshButton}
      {navigationControl}
      <h2 className={`${compactMobile ? 'min-w-[56px] text-[10px]' : 'min-w-[120px] text-[15px]'} flex-1 truncate px-0.5 text-center font-bold text-slate-800 dark:text-white`} title={getNavTitle()}>
        {getNavTitle()}
      </h2>
      {viewControl}
      {offHoursControl}
    </div>
  );
}