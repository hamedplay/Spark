import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Bell, ChevronDown, SlidersHorizontal, CalendarDays, Sparkles } from 'lucide-react';
import { MeetingsDashboard } from '../components/MeetingsDashboard';
import { MeetingCard } from '../components/MeetingCard';
import { PendingMeetingsModal } from '../components/MeetingCard/PendingMeetingsModal';
import { checkPermission } from '../../permissions';
import type { MeetingsPageProps } from '../types/meetingsPage';

export function MeetingsPage(props: MeetingsPageProps) {
  const {
    meetings, pendingMeetingsCount, fetchMeetings, fetchPendingMeetingsCount,
    searchTerm, setSearchTerm, statusFilter, setStatusFilter,
    priorityFilter, setPriorityFilter,
    showPendingMeetingsModal, setShowPendingMeetingsModal,
    setActivePage, setPendingSchedule,
    isAdmin, userPermissions,
  } = props;
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [focusMeetingId, setFocusMeetingId] = useState<string | null>(() => new URL(window.location.href).searchParams.get('meetingFocus'));
  const [dashboardMeetingView] = useState<string | null>(() => new URL(window.location.href).searchParams.get('meetingView'));

  useEffect(() => {
    if (!focusMeetingId && dashboardMeetingView !== 'open') return;
    setSearchTerm('');
    setPriorityFilter('all');
    setStatusFilter(focusMeetingId ? 'all' : 'open');
    const url = new URL(window.location.href);
    url.searchParams.delete('meetingFocus');
    url.searchParams.delete('meetingView');
    window.history.replaceState({}, '', url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredMeetings = meetings.filter(meeting => {
    if (focusMeetingId) return meeting.id === focusMeetingId;
    const matchesSearch = meeting.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         meeting.representative.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || meeting.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || meeting.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const stats = {
    totalMeetings: meetings.length,
    openMeetings: meetings.filter(m => m.status === 'open').length,
    completedMeetings: meetings.filter(m => m.status === 'archived').length,
    pendingMeetingsCount,
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchTerm.trim()) count += 1;
    if (statusFilter !== 'all') count += 1;
    if (priorityFilter !== 'all') count += 1;
    return count;
  }, [searchTerm, statusFilter, priorityFilter]);

  const hasPermission = (key: string): boolean => checkPermission(key, isAdmin, userPermissions);
  const hasPending = pendingMeetingsCount > 0;

  return (
    <>
      <div
        className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/75 to-indigo-50/45 p-3 antialiased shadow-[0_18px_50px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950/15 sm:p-4"
        dir="rtl"
      >
        <div className="pointer-events-none absolute -left-24 -top-28 h-64 w-64 rounded-full bg-violet-300/10 blur-3xl dark:bg-violet-600/10" />
        <div className="pointer-events-none absolute -right-20 top-32 h-56 w-56 rounded-full bg-cyan-200/15 blur-3xl dark:bg-cyan-500/10" />

        <div className="relative z-10">
          <header className="mb-3 flex flex-col justify-between gap-2.5 lg:flex-row lg:items-center">
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white/85 px-2.5 py-1 text-[10px] font-bold text-indigo-700 shadow-sm dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300">
                  <Sparkles className="h-3.5 w-3.5" /> مرکز درخواست جلسات
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/75 px-2.5 py-1 text-[9px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                  <CalendarDays className="h-3 w-3" /> {meetings.length.toLocaleString('fa-IR')} جلسه
                </span>
              </div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">درخواست جلسات</h1>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">ثبت، بررسی و پیگیری درخواست‌های جلسه</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
              <button
                onClick={() => setShowPendingMeetingsModal(true)}
                title="جلسات در انتظار تأیید"
                className={`relative inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 text-[10px] font-bold transition-all sm:text-xs ${
                  hasPending
                    ? 'border-rose-200 bg-rose-50 text-rose-700 shadow-[0_5px_16px_rgba(244,63,94,0.10)] ring-1 ring-rose-200/70 hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-400/20 dark:hover:bg-rose-500/20'
                    : 'border-amber-200 bg-amber-50/80 text-amber-700 hover:bg-amber-100 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15'
                }`}
              >
                <Bell className="h-4 w-4" />
                <span>در انتظار تأیید</span>
                {hasPending && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[9px] font-bold text-white">
                    {pendingMeetingsCount.toLocaleString('fa-IR')}
                  </span>
                )}
              </button>

              {hasPermission('meetings_create') && (
                <button
                  onClick={() => setActivePage('create-meeting')}
                  className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-violet-600 to-indigo-600 px-3.5 text-[10px] font-bold text-white shadow-[0_7px_20px_rgba(79,70,229,0.18)] transition hover:from-violet-500 hover:to-indigo-500 sm:text-xs"
                >
                  <Plus className="h-4 w-4" />
                  جلسه جدید
                </button>
              )}
            </div>
          </header>

          <MeetingsDashboard {...stats} />

          {focusMeetingId && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-cyan-200 bg-cyan-50/80 px-3 py-2 text-[10px] text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300 sm:text-xs">
              <span>جلسه انتخاب‌شده از داشبورد مدیریتی نمایش داده شده است.</span>
              <button type="button" onClick={() => setFocusMeetingId(null)} className="flex-shrink-0 rounded-lg border border-cyan-200 bg-white px-2.5 py-1 font-bold transition hover:bg-cyan-100 dark:border-cyan-500/25 dark:bg-slate-900/50 dark:hover:bg-cyan-500/10">نمایش همه جلسات</button>
            </div>
          )}

          <section className="mb-3 rounded-xl border border-slate-200/80 bg-white/85 p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.035)] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/70 sm:p-3">
            <div className="flex items-center gap-2 sm:hidden">
              <button
                type="button"
                onClick={() => setMobileFiltersOpen(v => !v)}
                aria-expanded={mobileFiltersOpen}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 flex-shrink-0 text-violet-500 dark:text-violet-300" />
                  <span className="truncate">جست‌وجو و فیلتر</span>
                  {activeFilterCount > 0 && (
                    <span className="inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-violet-600 px-1.5 text-[9px] font-bold text-white">
                      {activeFilterCount.toLocaleString('fa-IR')}
                    </span>
                  )}
                </span>
                <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${mobileFiltersOpen ? 'rotate-180' : ''}`} />
              </button>
              <span className="flex-shrink-0 text-[10px] text-slate-400 dark:text-slate-500">{filteredMeetings.length.toLocaleString('fa-IR')} مورد</span>
            </div>

            <div className={`${mobileFiltersOpen ? 'mt-2.5 flex' : 'hidden'} flex-col gap-2 sm:mt-0 sm:flex sm:flex-row sm:items-center sm:gap-2.5`}>
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="عنوان جلسه یا نماینده..."
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-4 pr-10 text-xs text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-violet-500/40"
                />
              </div>

              <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex">
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value as 'all' | 'high' | 'medium' | 'low')}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 sm:w-auto"
                >
                  <option value="all">همه اولویت‌ها</option>
                  <option value="high">بالا</option>
                  <option value="medium">متوسط</option>
                  <option value="low">پایین</option>
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | 'open' | 'archived')}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 sm:w-auto"
                >
                  <option value="all">همه جلسات</option>
                  <option value="open">باز</option>
                  <option value="archived">بایگانی‌شده</option>
                </select>
              </div>

              <div className="hidden flex-shrink-0 items-center gap-1.5 pl-1 text-[10px] text-slate-400 dark:text-slate-500 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                {filteredMeetings.length.toLocaleString('fa-IR')} نتیجه
              </div>
            </div>
          </section>

          <div className="mb-2.5 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100 sm:text-sm">فهرست درخواست‌ها</h2>
              <p className="mt-0.5 text-[9px] text-slate-400 dark:text-slate-500 sm:text-[10px]">وضعیت و اقدامات هر جلسه در یک نگاه</p>
            </div>
            {activeFilterCount > 0 && (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-[9px] font-bold text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300">
                {activeFilterCount.toLocaleString('fa-IR')} فیلتر فعال
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
            {filteredMeetings.map(meeting => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                onUpdate={fetchMeetings}
                onScheduleInCalendar={(m) => {
                  setPendingSchedule({ meetingId: m.id, meeting: m });
                  setActivePage('calendar');
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {showPendingMeetingsModal && (
        <PendingMeetingsModal
          onClose={() => setShowPendingMeetingsModal(false)}
          onUpdate={() => {
            void fetchMeetings();
            void fetchPendingMeetingsCount();
          }}
        />
      )}
    </>
  );
}
