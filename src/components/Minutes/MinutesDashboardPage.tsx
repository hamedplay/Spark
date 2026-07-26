import { useEffect, useState } from 'react';
import { FileText, Clock, CircleCheck as CheckCircle, CircleAlert as AlertCircle, TrendingUp, Plus, ChevronLeft, ArrowLeft, ChartBar as BarChart3 } from 'lucide-react';
import {
  PageHeader, StatCard, MinutesStatusBadge, DecisionStatusBadge,
  DecisionPriorityBadge, ProgressIndicator, EmptyState, TableSkeleton,
} from './MinutesShared';
import { supabase } from '../../lib/supabase';
import { setMinuteIdInUrl, setMinutesPageInUrl } from '../../lib/minutesNavigation';

interface Props {
  onNavigate: (page: string) => void;
}

interface DashboardStats {
  total_minutes: number;
  draft: number;
  pending_approval: number;
  changes_requested: number;
  approved: number;
  published: number;
  open_decisions: number;
  overdue_decisions: number;
  pending_my_approval: number;
  status_counts: Record<string, number>;
  decision_status_counts: Record<string, number>;
  created_last_30: number;
  decisions_near_deadline: number;
  top_units: { unit: string; open_decisions: number }[];
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'پیش‌نوانس',
  pending_approval: 'در انتظار تأیید',
  changes_requested: 'درخواست اصلاح',
  approved: 'تأییدشده',
  published: 'منتشرشده',
  not_started: 'شروع‌نشده',
  planned: 'برنامه‌ریزی‌شده',
  in_progress: 'در حال انجام',
  waiting_coordination: 'منتظر هماهنگی',
  waiting_approval: 'منتظر تأیید',
  completed: 'تکمیل‌شده',
  stopped: 'متوقف‌شده',
};

export function MinutesDashboardPage({ onNavigate }: Props) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const { data, error: rpcErr } = await supabase.rpc('get_minutes_dashboard_stats');
        if (rpcErr) throw new Error(rpcErr.message);
        if (!cancelled) setStats(data as DashboardStats);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'بارگذاری داشبورد ناموفق بود.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const goDetail = (id: string) => {
    setMinuteIdInUrl(id);
    setMinutesPageInUrl('minutes-detail');
    onNavigate('minutes-detail');
  };

  if (loading) return (
    <div dir="rtl" className="space-y-6">
      <PageHeader title="داشبورد صورت‌جلسات" description="خلاصه وضعیت صورت‌جلسات و مصوبات شما" />
      <TableSkeleton rows={4} />
    </div>
  );
  if (error) return (
    <div dir="rtl" className="space-y-6">
      <PageHeader title="داشبورد صورت‌جلسات" />
      <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">{error}</div>
    </div>
  );
  if (!stats) return null;

  const statusEntries = Object.entries(stats.status_counts || {});
  const decStatusEntries = Object.entries(stats.decision_status_counts || {});

  return (
    <div dir="rtl" className="space-y-6">
      <PageHeader
        title="داشبورد صورت‌جلسات"
        description="خلاصه وضعیت صورت‌جلسات و مصوبات شما"
        actions={
          <button
            onClick={() => onNavigate('minutes-new')}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            صورت‌جلسه جدید
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="کل صورت‌جلسات" value={stats.total_minutes} icon={<FileText className="w-6 h-6 text-gray-500" />} colorClass="bg-gray-100 dark:bg-gray-700" onClick={() => onNavigate('minutes')} />
        <StatCard label="پیش‌نویس" value={stats.draft} icon={<FileText className="w-6 h-6 text-gray-500" />} colorClass="bg-gray-100 dark:bg-gray-700" onClick={() => onNavigate('minutes')} />
        <StatCard label="منتظر تأیید من" value={stats.pending_my_approval} icon={<Clock className="w-6 h-6 text-amber-500" />} colorClass="bg-amber-50 dark:bg-amber-900/20" onClick={() => onNavigate('minutes-approvals')} />
        <StatCard label="مصوبات فعال" value={stats.open_decisions} icon={<TrendingUp className="w-6 h-6 text-blue-500" />} colorClass="bg-blue-50 dark:bg-blue-900/20" onClick={() => onNavigate('minutes-my-decisions')} />
        <StatCard label="عقب‌افتاده" value={stats.overdue_decisions} icon={<AlertCircle className="w-6 h-6 text-red-500" />} colorClass="bg-red-50 dark:bg-red-900/20" onClick={() => onNavigate('minutes-followup')} />
        <StatCard label="نزدیک سررسید" value={stats.decisions_near_deadline} icon={<Clock className="w-6 h-6 text-orange-500" />} colorClass="bg-orange-50 dark:bg-orange-900/20" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2"><BarChart3 className="w-4 h-4 text-blue-500" /> توزیع وضعیت صورت‌جلسات</h2>
            <button onClick={() => onNavigate('minutes')} className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">همه <ChevronLeft className="w-4 h-4" /></button>
          </div>
          {statusEntries.length === 0 ? (
            <EmptyState icon={<FileText className="w-8 h-8" />} title="داده‌ای نیست" />
          ) : (
            <div className="space-y-2">
              {statusEntries.map(([k, v]) => {
                const pct = stats.total_minutes > 0 ? Math.round((v / stats.total_minutes) * 100) : 0;
                return (
                  <div key={k} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-28 whitespace-nowrap">{STATUS_LABELS[k] || k}</span>
                    <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                      <div className="h-2 bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-8 text-left">{v}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-900 dark:text-white flex items-center gap-2"><BarChart3 className="w-4 h-4 text-green-500" /> توزیع وضعیت مصوبات</h2>
            <button onClick={() => onNavigate('minutes-my-decisions')} className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">همه <ChevronLeft className="w-4 h-4" /></button>
          </div>
          {decStatusEntries.length === 0 ? (
            <EmptyState icon={<CheckCircle className="w-8 h-8" />} title="داده‌ای نیست" />
          ) : (
            <div className="space-y-2">
              {decStatusEntries.map(([k, v]) => (
                <div key={k} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-28 whitespace-nowrap">{STATUS_LABELS[k] || k}</span>
                  <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div className="h-2 bg-green-500 rounded-full" style={{ width: `${Math.min(100, v * 10)}%` }} />
                  </div>
                  <span className="text-xs text-gray-500 w-8 text-left">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-bold text-gray-900 dark:text-white mb-4">ایجاد صورت‌جلسات (۳۰ روز اخیر)</h2>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">{stats.created_last_30}</div>
            <p className="text-sm text-gray-500">صورت‌جلسه در ۳۰ روز گذشته</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <h2 className="font-bold text-gray-900 dark:text-white mb-4">واحدهای دارای بیشترین مصوبه باز</h2>
          {stats.top_units.length === 0 ? (
            <EmptyState icon={<TrendingUp className="w-8 h-8" />} title="داده‌ای نیست" />
          ) : (
            <div className="space-y-2">
              {stats.top_units.map((u, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700 dark:text-gray-300">{u.unit}</span>
                  <span className="text-gray-500">{u.open_decisions} مصوبه باز</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
