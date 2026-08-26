import { ChartBar as BarChart3, CircleCheck as CheckCircle, Clock, Bell } from 'lucide-react';

interface MeetingsDashboardProps {
  totalMeetings: number;
  openMeetings: number;
  completedMeetings: number;
  pendingMeetingsCount?: number;
}

const statItems = [
  {
    key: 'total',
    label: 'کل جلسات',
    helper: 'همه درخواست‌ها',
    Icon: BarChart3,
    cardClass: 'border-indigo-100 bg-gradient-to-br from-white to-indigo-50/55 dark:border-indigo-500/20 dark:from-slate-900 dark:to-indigo-950/25',
    iconClass: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  },
  {
    key: 'open',
    label: 'جلسات باز',
    helper: 'قابل پیگیری',
    Icon: Clock,
    cardClass: 'border-amber-100 bg-gradient-to-br from-white to-amber-50/55 dark:border-amber-500/20 dark:from-slate-900 dark:to-amber-950/20',
    iconClass: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  },
  {
    key: 'completed',
    label: 'تکمیل‌شده',
    helper: 'بسته و بایگانی',
    Icon: CheckCircle,
    cardClass: 'border-emerald-100 bg-gradient-to-br from-white to-emerald-50/55 dark:border-emerald-500/20 dark:from-slate-900 dark:to-emerald-950/20',
    iconClass: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  {
    key: 'pending',
    label: 'در انتظار تأیید',
    helper: 'نیازمند بررسی',
    Icon: Bell,
    cardClass: 'border-rose-100 bg-gradient-to-br from-white to-rose-50/55 dark:border-rose-500/20 dark:from-slate-900 dark:to-rose-950/20',
    iconClass: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  },
] as const;

export function MeetingsDashboard({ totalMeetings, openMeetings, completedMeetings, pendingMeetingsCount = 0 }: MeetingsDashboardProps) {
  const values = {
    total: totalMeetings,
    open: openMeetings,
    completed: completedMeetings,
    pending: pendingMeetingsCount,
  };

  return (
    <div className="mb-3 grid grid-cols-2 gap-2 sm:mb-4 sm:gap-2.5 lg:grid-cols-4">
      {statItems.map(({ key, label, helper, Icon, cardClass, iconClass }) => {
        const needsAttention = key === 'pending' && pendingMeetingsCount > 0;
        return (
          <div
            key={key}
            className={`relative overflow-hidden rounded-xl border p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.035)] sm:p-3 ${cardClass} ${needsAttention ? 'ring-1 ring-rose-300/70 dark:ring-rose-400/40' : ''}`}
          >
            {needsAttention && <span className="absolute inset-y-0 right-0 w-1 bg-rose-500" />}
            <div className="flex items-center justify-between gap-2.5">
              <div className="min-w-0">
                <p className="truncate text-[10px] font-bold text-slate-500 dark:text-slate-400">{label}</p>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <h3 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                    {values[key].toLocaleString('fa-IR')}
                  </h3>
                  <span className={`truncate text-[9px] ${needsAttention ? 'font-bold text-rose-600 dark:text-rose-300' : 'text-slate-400 dark:text-slate-500'}`}>
                    {needsAttention ? 'نیازمند توجه' : helper}
                  </span>
                </div>
              </div>
              <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9 ${iconClass}`}>
                <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
