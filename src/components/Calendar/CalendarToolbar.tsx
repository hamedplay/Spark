import { Calendar, PanelRight, Search, RefreshCw, ChevronRight, ChevronLeft, ChevronDown, Clock, MapPin } from 'lucide-react';
import { toJalaali } from './utils';
import type { MeetingData } from '../types';

interface ViewOption { key: string; label: string; }

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

  return (
    <div className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 flex-wrap sm:flex-nowrap">
      {/* Mobile sidebar toggle — only visible on small screens */}
      <button onClick={() => setShowMobileSidebar(true)} className="lg:hidden p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex-shrink-0">
        <Calendar className="w-5 h-5 text-gray-600 dark:text-gray-300" />
      </button>
      {/* Desktop sidebar toggle — only visible on large screens */}
      <button
        onClick={() => setShowDesktopSidebar(v => !v)}
        className={`hidden lg:flex p-1.5 rounded-lg flex-shrink-0 transition-colors ${showDesktopSidebar ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
        title={showDesktopSidebar ? 'پنهان کردن تقویم‌ها' : 'نمایش تقویم‌ها'}
      >
        <PanelRight className="w-4 h-4" />
      </button>
      <button onClick={goToToday} className="px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-white font-medium flex-shrink-0">امروز</button>
      {/* Search button + panel */}
      <div ref={searchRef} className="relative flex-shrink-0">
        <button onClick={() => setShowSearch(v => !v)} className={`p-1.5 rounded-lg transition-colors ${showSearch ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'}`} title="جستجوی جلسات">
          <Search className="w-4 h-4" />
        </button>
        {showSearch && (
          <div className="absolute right-0 top-full mt-1.5 w-72 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 z-[70] overflow-hidden" dir="rtl">
            <div className="p-2 border-b border-gray-100 dark:border-gray-700">
              <div className="relative">
                <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input ref={searchInputRef} type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="جستجوی جلسات..." dir="rtl"
                  className="w-full pr-8 pl-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:text-white placeholder-gray-400"
                />
              </div>
            </div>
            {searchResults.length > 0 ? (
              <div className="max-h-64 overflow-y-auto py-1">
                {searchResults.map(m => {
                  const dateStr = parseRequestDateToDateStr(m.request_date);
                  const j = dateStr ? toJalaali(new Date(dateStr + 'T12:00:00')) : null;
                  return (
                    <button key={m.id} onClick={() => navigateToMeeting(m)}
                      className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 text-right transition-colors">
                      <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{m.subject}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {j && <span className="text-xs text-gray-400">{j.jy}/{String(j.jm).padStart(2,'0')}/{String(j.jd).padStart(2,'0')}</span>}
                          {m.start_time && <span className="text-xs text-blue-500">{m.start_time}</span>}
                          {m.location && <span className="text-xs text-gray-400 flex items-center gap-0.5"><MapPin className="w-3 h-3" />{m.location}</span>}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : searchQuery.trim() ? (
              <div className="py-6 text-center text-sm text-gray-400">جلسه‌ای یافت نشد</div>
            ) : (
              <div className="py-4 text-center text-xs text-gray-400">موضوع، محل یا نماینده را وارد کنید</div>
            )}
          </div>
        )}
      </div>
      <button onClick={() => fetchMeetings()} disabled={isRefreshing} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"><RefreshCw className={`w-4 h-4 text-gray-500 dark:text-gray-400 ${isRefreshing ? 'animate-spin' : ''}`} /></button>
      <button onClick={navigatePrev} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex-shrink-0"><ChevronRight className="w-5 h-5 dark:text-white" /></button>
      <button onClick={navigateNext} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg flex-shrink-0"><ChevronLeft className="w-5 h-5 dark:text-white" /></button>
      <h2 className="text-sm sm:text-base font-semibold dark:text-white flex-1 text-center min-w-0 truncate">{getNavTitle()}</h2>
      <div className="relative flex-shrink-0">
        <button onClick={() => setShowViewDropdown(o => !o)}
          className="flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 text-xs sm:text-sm border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-white min-w-[70px] sm:min-w-[90px] justify-between">
          <span className="hidden sm:inline">{VIEW_OPTIONS.find(v => v.key === viewMode)?.label || 'روز'}</span>
          <span className="sm:hidden">{VIEW_OPTIONS.find(v => v.key === viewMode)?.label?.slice(0,3) || 'روز'}</span>
          <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
        {showViewDropdown && (
          <div className="absolute left-0 top-full mt-1 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 py-1 z-50 min-w-[130px]">
            {VIEW_OPTIONS.map(v => (
              <button key={v.key} onClick={() => { setViewMode(v.key); setShowViewDropdown(false); }}
                className={`w-full text-right px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2 ${viewMode === v.key ? 'text-blue-500 font-semibold' : 'dark:text-white'}`}>
                {viewMode === v.key && <div className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />}
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {(canHideOffHours || prefsHideOffhours !== undefined) && (
        <button
          onClick={() => { const next = !hideOffHours; setHideOffHours(next); updatePrefs({ hide_offhours: next }); }}
          title={hideOffHours ? 'نمایش ساعات غیرکاری' : 'پنهان کردن ساعات غیرکاری'}
          className={`p-1.5 rounded-lg flex-shrink-0 transition-colors ${hideOffHours ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
        >
          <Clock className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
