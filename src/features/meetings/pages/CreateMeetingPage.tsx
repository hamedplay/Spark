import { CalendarPlus, ChevronRight } from 'lucide-react';
import { CreateMeetingForm } from '../components/CreateMeetingForm';
import type { CreateMeetingPageProps } from '../types/meetingsPage';

export function CreateMeetingPage(props: CreateMeetingPageProps) {
  const { prefillData, setActivePage, setSparkMeetingPrefill, fetchMeetings } = props;

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-1 sm:p-2" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
            <CalendarPlus className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">ایجاد جلسه جدید</h2>
            <p className="mt-0.5 text-[10px] text-slate-400">اطلاعات جلسه، شرکت‌کنندگان و زمان‌بندی را ثبت کنید.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setActivePage('meetings'); setSparkMeetingPrefill(null); }}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-bold text-slate-600 transition hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-violet-500/30 dark:hover:bg-violet-500/10 dark:hover:text-violet-300"
        >
          <ChevronRight className="h-3.5 w-3.5" />
          بازگشت به جلسات
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-900">
        <CreateMeetingForm
          prefillData={prefillData || undefined}
          onSuccess={() => {
            setActivePage('meetings');
            setSparkMeetingPrefill(null);
            void fetchMeetings();
          }}
        />
      </div>
    </div>
  );
}
