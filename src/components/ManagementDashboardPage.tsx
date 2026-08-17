import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Gauge,
  ListTodo,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UsersRound,
  Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';

interface DashboardStats {
  total_tasks: number;
  today_tasks: number;
  in_progress_tasks: number;
  completed_tasks: number;
  overdue_tasks: number;
  urgent_tasks: number;
  active_meetings: number;
  total_meetings: number;
  total_decisions: number;
  completion_rate: number;
}

interface StatusDistributionItem {
  status: 'completed' | 'in_progress' | 'pending' | 'overdue' | string;
  count: number;
}

interface TaskTrendItem {
  month_start: string;
  completed: number;
  in_progress: number;
  overdue: number;
  total: number;
}

interface UnitPerformanceItem {
  unit_name: string;
  decision_count: number;
  progress_percent: number;
}

interface RecentMeetingItem {
  id: string;
  subject: string;
  meeting_date: string | null;
  start_time: string | null;
  status: string;
  status_type: string;
  priority: string;
}

interface ImportantTaskItem {
  id: string;
  title: string;
  status: string;
  dashboard_status: string;
  priority: string;
  assignee: string;
  due_local_date: string | null;
}

interface TodayScheduleItem {
  id: string;
  subject: string;
  start_time: string | null;
  location: string;
  is_online: boolean;
  status_type: string;
}

interface DeadlineAlertItem {
  id: string;
  source: 'task' | 'decision';
  title: string;
  due_date: string;
  days_remaining: number;
  priority: string;
}

interface ManagementDashboardData {
  generated_at: string;
  timezone: string;
  stats: DashboardStats;
  status_distribution: StatusDistributionItem[];
  task_trend: TaskTrendItem[];
  unit_performance: UnitPerformanceItem[];
  recent_meetings: RecentMeetingItem[];
  important_tasks: ImportantTaskItem[];
  today_schedule: TodayScheduleItem[];
  deadline_alerts: DeadlineAlertItem[];
}

type Tone = 'blue' | 'violet' | 'cyan' | 'green' | 'rose' | 'amber' | 'teal';

const nf = new Intl.NumberFormat('fa-IR');
const percentNf = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
const persianDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const persianMonth = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'short' });
const generatedAtFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const statusMeta: Record<string, { label: string; color: string }> = {
  completed: { label: 'تکمیل‌شده', color: '#10b981' },
  in_progress: { label: 'در حال انجام', color: '#38bdf8' },
  pending: { label: 'در انتظار', color: '#f59e0b' },
  overdue: { label: 'عقب‌مانده', color: '#f43f5e' },
};

const toneClasses: Record<Tone, { card: string; icon: string; accent: string }> = {
  blue: {
    card: 'border-blue-500/25 bg-gradient-to-b from-blue-500/10 to-blue-500/[0.02]',
    icon: 'bg-blue-500/15 text-blue-300 ring-blue-400/20',
    accent: 'text-blue-300',
  },
  violet: {
    card: 'border-violet-500/25 bg-gradient-to-b from-violet-500/10 to-violet-500/[0.02]',
    icon: 'bg-violet-500/15 text-violet-300 ring-violet-400/20',
    accent: 'text-violet-300',
  },
  cyan: {
    card: 'border-cyan-500/25 bg-gradient-to-b from-cyan-500/10 to-cyan-500/[0.02]',
    icon: 'bg-cyan-500/15 text-cyan-300 ring-cyan-400/20',
    accent: 'text-cyan-300',
  },
  green: {
    card: 'border-emerald-500/25 bg-gradient-to-b from-emerald-500/10 to-emerald-500/[0.02]',
    icon: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/20',
    accent: 'text-emerald-300',
  },
  rose: {
    card: 'border-rose-500/25 bg-gradient-to-b from-rose-500/10 to-rose-500/[0.02]',
    icon: 'bg-rose-500/15 text-rose-300 ring-rose-400/20',
    accent: 'text-rose-300',
  },
  amber: {
    card: 'border-amber-500/25 bg-gradient-to-b from-amber-500/10 to-amber-500/[0.02]',
    icon: 'bg-amber-500/15 text-amber-300 ring-amber-400/20',
    accent: 'text-amber-300',
  },
  teal: {
    card: 'border-teal-500/25 bg-gradient-to-b from-teal-500/10 to-teal-500/[0.02]',
    icon: 'bg-teal-500/15 text-teal-300 ring-teal-400/20',
    accent: 'text-teal-300',
  },
};

function toSafeNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : persianDate.format(d);
}

function formatMonth(value: string): string {
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : persianMonth.format(d);
}

function formatTime(value: string | null | undefined): string {
  return value ? value.slice(0, 5) : '—';
}

function normalizeDashboardData(input: unknown): ManagementDashboardData | null {
  if (!input || typeof input !== 'object') return null;
  const data = input as Partial<ManagementDashboardData>;
  const stats = (data.stats || {}) as Partial<DashboardStats>;
  return {
    generated_at: String(data.generated_at || new Date().toISOString()),
    timezone: String(data.timezone || 'Asia/Tehran'),
    stats: {
      total_tasks: toSafeNumber(stats.total_tasks),
      today_tasks: toSafeNumber(stats.today_tasks),
      in_progress_tasks: toSafeNumber(stats.in_progress_tasks),
      completed_tasks: toSafeNumber(stats.completed_tasks),
      overdue_tasks: toSafeNumber(stats.overdue_tasks),
      urgent_tasks: toSafeNumber(stats.urgent_tasks),
      active_meetings: toSafeNumber(stats.active_meetings),
      total_meetings: toSafeNumber(stats.total_meetings),
      total_decisions: toSafeNumber(stats.total_decisions),
      completion_rate: Math.max(0, Math.min(100, toSafeNumber(stats.completion_rate))),
    },
    status_distribution: Array.isArray(data.status_distribution) ? data.status_distribution : [],
    task_trend: Array.isArray(data.task_trend) ? data.task_trend : [],
    unit_performance: Array.isArray(data.unit_performance) ? data.unit_performance : [],
    recent_meetings: Array.isArray(data.recent_meetings) ? data.recent_meetings : [],
    important_tasks: Array.isArray(data.important_tasks) ? data.important_tasks : [],
    today_schedule: Array.isArray(data.today_schedule) ? data.today_schedule : [],
    deadline_alerts: Array.isArray(data.deadline_alerts) ? data.deadline_alerts : [],
  };
}

function Panel({
  title,
  subtitle,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-700/60 bg-slate-950/35 p-4 shadow-[0_18px_55px_rgba(0,0,0,0.18)] backdrop-blur-sm ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100 sm:text-base">{title}</h3>
          {subtitle && <p className="mt-1 text-[11px] text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  title: string;
  value: number | string;
  sub: string;
  icon: React.ElementType;
  tone: Tone;
}) {
  const styles = toneClasses[tone];
  return (
    <div className={`min-w-0 rounded-2xl border p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.12)] ${styles.card}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium text-slate-400">{title}</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-white">{typeof value === 'number' ? nf.format(value) : value}</p>
        </div>
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ring-1 ${styles.icon}`}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      <p className={`mt-2 truncate text-[10px] ${styles.accent}`}>{sub}</p>
    </div>
  );
}

function CompletionGauge({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <div className="flex h-full min-h-[118px] flex-col items-center justify-center rounded-2xl border border-blue-500/25 bg-gradient-to-b from-blue-500/10 to-violet-500/[0.03] p-3">
      <p className="mb-2 text-[11px] font-medium text-slate-400">نرخ تکمیل کلی</p>
      <div
        className="relative flex h-16 w-16 items-center justify-center rounded-full p-[6px] shadow-[0_0_25px_rgba(59,130,246,0.22)]"
        style={{ background: `conic-gradient(#3b82f6 ${safe}%, rgba(51,65,85,.65) ${safe}% 100%)` }}
      >
        <div className="flex h-full w-full items-center justify-center rounded-full bg-[#071426] text-lg font-black text-white">
          {percentNf.format(safe)}٪
        </div>
      </div>
      <p className="mt-2 text-[10px] text-blue-300">براساس همه تسک‌های فعال</p>
    </div>
  );
}

function TrendChart({ data }: { data: TaskTrendItem[] }) {
  const width = 680;
  const height = 230;
  const padX = 34;
  const padY = 26;
  const maxValue = Math.max(1, ...data.flatMap(item => [item.completed, item.in_progress, item.overdue, item.total]));
  const plotWidth = width - padX * 2;
  const plotHeight = height - padY * 2;
  const xFor = (index: number) => data.length <= 1 ? width / 2 : padX + (index * plotWidth) / (data.length - 1);
  const yFor = (value: number) => padY + plotHeight - (value / maxValue) * plotHeight;
  const points = (key: 'completed' | 'in_progress' | 'overdue') => data.map((item, i) => `${xFor(i)},${yFor(item[key])}`).join(' ');

  if (!data.length) {
    return <div className="flex h-56 items-center justify-center text-sm text-slate-500">داده‌ای برای نمایش وجود ندارد</div>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-4 text-[11px] text-slate-400">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />تکمیل‌شده</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" />در حال انجام</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" />عقب‌مانده</span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height + 28}`} className="h-[250px] min-w-[580px] w-full" role="img" aria-label="روند وضعیت تسک‌ها">
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padY + plotHeight - ratio * plotHeight;
            return (
              <g key={ratio}>
                <line x1={padX} x2={width - padX} y1={y} y2={y} stroke="rgba(100,116,139,.18)" strokeWidth="1" />
                <text x={padX - 9} y={y + 4} textAnchor="end" fontSize="10" fill="#64748b">{nf.format(Math.round(maxValue * ratio))}</text>
              </g>
            );
          })}
          <polyline fill="none" stroke="#10b981" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={points('completed')} />
          <polyline fill="none" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={points('in_progress')} />
          <polyline fill="none" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" points={points('overdue')} />
          {data.map((item, index) => (
            <g key={item.month_start}>
              <circle cx={xFor(index)} cy={yFor(item.completed)} r="4" fill="#10b981" />
              <circle cx={xFor(index)} cy={yFor(item.in_progress)} r="4" fill="#38bdf8" />
              <circle cx={xFor(index)} cy={yFor(item.overdue)} r="4" fill="#fb7185" />
              <text x={xFor(index)} y={height + 15} textAnchor="middle" fontSize="11" fill="#94a3b8">{formatMonth(item.month_start)}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

function DistributionDonut({ items, total }: { items: StatusDistributionItem[]; total: number }) {
  const ordered = ['completed', 'in_progress', 'pending', 'overdue'].map(status => ({
    status,
    count: toSafeNumber(items.find(item => item.status === status)?.count),
  }));
  let cursor = 0;
  const gradientParts = ordered.map(item => {
    const meta = statusMeta[item.status];
    const start = cursor;
    const pct = total > 0 ? (item.count / total) * 100 : 0;
    cursor += pct;
    return `${meta.color} ${start}% ${cursor}%`;
  });
  if (cursor < 100) gradientParts.push(`rgba(51,65,85,.5) ${cursor}% 100%`);

  return (
    <div className="grid gap-5 sm:grid-cols-[160px_1fr] sm:items-center">
      <div className="relative mx-auto h-36 w-36">
        <div className="absolute inset-0 rounded-full p-[18px]" style={{ background: `conic-gradient(${gradientParts.join(',')})` }}>
          <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-[#071426] shadow-inner">
            <span className="text-2xl font-black text-white">{nf.format(total)}</span>
            <span className="mt-0.5 text-[10px] text-slate-500">کل تسک‌ها</span>
          </div>
        </div>
      </div>
      <div className="space-y-2.5">
        {ordered.map(item => {
          const meta = statusMeta[item.status];
          const pct = total ? Math.round((item.count / total) * 100) : 0;
          return (
            <div key={item.status} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-2 text-slate-300"><span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: meta.color }} />{meta.label}</span>
              <span className="text-slate-400">{nf.format(item.count)} <span className="text-slate-600">({nf.format(pct)}٪)</span></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-slate-700/60 text-xs text-slate-500">{text}</div>;
}

export function ManagementDashboardPage() {
  const [data, setData] = useState<ManagementDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadDashboard = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const { data: rpcData, error } = await supabase.rpc('get_management_dashboard_v1');
      if (error) throw error;
      const normalized = normalizeDashboardData(rpcData);
      if (!normalized) throw new Error('INVALID_MANAGEMENT_DASHBOARD_RESPONSE');
      setData(normalized);
    } catch (error) {
      console.error('[ManagementDashboardPage] load failed', error);
      toast.error('بارگذاری داشبورد مدیریتی ناموفق بود');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const insights = useMemo(() => {
    if (!data) return [] as string[];
    const result: string[] = [];
    if (data.stats.overdue_tasks > 0) {
      result.push(`${nf.format(data.stats.overdue_tasks)} تسک از مهلت عبور کرده و نیازمند تعیین تکلیف مدیریتی است.`);
    }
    if (data.stats.completion_rate >= 70) {
      result.push(`نرخ تکمیل فعلی ${nf.format(data.stats.completion_rate)}٪ است و در محدوده مطلوب قرار دارد.`);
    } else {
      result.push(`نرخ تکمیل فعلی ${nf.format(data.stats.completion_rate)}٪ است؛ تمرکز روی تسک‌های در حال انجام می‌تواند نتیجه را بهبود دهد.`);
    }
    const topUnit = data.unit_performance[0];
    if (topUnit) {
      result.push(`${topUnit.unit_name} با میانگین پیشرفت ${nf.format(topUnit.progress_percent)}٪ بالاترین عملکرد ثبت‌شده در مصوبات را دارد.`);
    }
    return result.slice(0, 3);
  }, [data]);

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center rounded-3xl bg-[#06101f] text-slate-200">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-9 w-9 animate-spin text-violet-400" />
          <span className="text-sm text-slate-400">در حال آماده‌سازی داشبورد مدیریتی...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 rounded-3xl border border-slate-700 bg-[#06101f] px-5 text-center text-slate-200">
        <AlertTriangle className="h-10 w-10 text-amber-400" />
        <div>
          <h2 className="font-bold">داشبورد مدیریتی در دسترس نیست</h2>
          <p className="mt-1 text-sm text-slate-500">داده‌ها دریافت نشدند. دوباره تلاش کنید.</p>
        </div>
        <button onClick={() => void loadDashboard()} className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500">تلاش مجدد</button>
      </div>
    );
  }

  const stats = data.stats;
  const kpis = [
    { title: 'کل تسک‌ها', value: stats.total_tasks, sub: 'همه تسک‌های غیرآرشیوی', icon: ListTodo, tone: 'blue' as Tone },
    { title: 'تسک‌های امروز', value: stats.today_tasks, sub: 'سررسید امروز', icon: CalendarDays, tone: 'violet' as Tone },
    { title: 'در حال انجام', value: stats.in_progress_tasks, sub: 'نیازمند ادامه کار', icon: Activity, tone: 'cyan' as Tone },
    { title: 'تکمیل‌شده', value: stats.completed_tasks, sub: 'تسک‌های بسته‌شده', icon: CheckCircle2, tone: 'green' as Tone },
    { title: 'عقب‌مانده', value: stats.overdue_tasks, sub: 'عبور کرده از مهلت', icon: Clock3, tone: 'rose' as Tone },
    { title: 'تسک‌های فوری', value: stats.urgent_tasks, sub: 'اولویت بالا و باز', icon: Zap, tone: 'amber' as Tone },
    { title: 'جلسات فعال', value: stats.active_meetings, sub: `از ${nf.format(stats.total_meetings)} جلسه ثبت‌شده`, icon: BriefcaseBusiness, tone: 'teal' as Tone },
  ];

  return (
    <div className="relative overflow-hidden rounded-[28px] border border-slate-800/80 bg-[#06101f] p-3 text-slate-100 shadow-[0_28px_80px_rgba(2,6,23,0.35)] sm:p-5" dir="rtl">
      <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-violet-600/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-40 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="relative z-10 space-y-4">
        <header className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold text-amber-300">
                <ShieldCheck className="h-3.5 w-3.5" /> دسترسی ویژه مدیریت
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-[10px] text-slate-500">مستقل از دسترسی Admin</span>
            </div>
            <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">داشبورد مدیریتی</h1>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">نمای کلی عملکرد، تسک‌ها، جلسات، مصوبات و وضعیت واحدهای سازمانی</p>
          </div>
          <div className="flex items-center gap-2 self-start lg:self-auto">
            <div className="hidden rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-left sm:block">
              <p className="text-[9px] uppercase tracking-widest text-slate-600">آخرین بروزرسانی</p>
              <p className="mt-0.5 text-[11px] text-slate-400">{generatedAtFormatter.format(new Date(data.generated_at))}</p>
            </div>
            <button
              type="button"
              onClick={() => void loadDashboard(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3.5 py-2.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              بروزرسانی
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-8">
          {kpis.map(item => <KpiCard key={item.title} {...item} />)}
          <CompletionGauge value={stats.completion_rate} />
        </div>

        <div className="grid gap-3 xl:grid-cols-12">
          <Panel title="روند تکمیل تسک‌ها" subtitle="وضعیت فعلی تسک‌ها به تفکیک ماه ایجاد" className="xl:col-span-5">
            <TrendChart data={data.task_trend} />
          </Panel>

          <Panel title="عملکرد واحدها" subtitle="میانگین پیشرفت مصوبات به تفکیک واحد مسئول" className="xl:col-span-3">
            {data.unit_performance.length ? (
              <div className="space-y-4">
                {data.unit_performance.map((item, index) => (
                  <div key={`${item.unit_name}-${index}`}>
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px]">
                      <span className="min-w-0 truncate text-slate-300" title={item.unit_name}>{item.unit_name}</span>
                      <span className="flex-shrink-0 font-semibold text-slate-400">{nf.format(item.progress_percent)}٪</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-gradient-to-l from-emerald-400 via-cyan-400 to-blue-500" style={{ width: `${Math.max(2, Math.min(100, item.progress_percent))}%` }} />
                    </div>
                    <p className="mt-1 text-[9px] text-slate-600">{nf.format(item.decision_count)} مصوبه</p>
                  </div>
                ))}
              </div>
            ) : <EmptyState text="برای عملکرد واحدها هنوز داده کافی وجود ندارد" />}
          </Panel>

          <Panel title="توزیع تسک‌ها بر اساس وضعیت" subtitle="نمای تجمعی و بدون هم‌پوشانی وضعیت‌ها" className="xl:col-span-4">
            <DistributionDonut items={data.status_distribution} total={stats.total_tasks} />
          </Panel>
        </div>

        <div className="grid gap-3 xl:grid-cols-12">
          <Panel title="جلسات اخیر" subtitle="آخرین جلسات ثبت‌شده در سامانه" className="xl:col-span-3">
            {data.recent_meetings.length ? (
              <div className="space-y-2">
                {data.recent_meetings.map((meeting) => (
                  <div key={meeting.id} className="rounded-xl border border-slate-800/80 bg-slate-900/35 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="line-clamp-2 text-xs font-medium leading-5 text-slate-200">{meeting.subject}</p>
                      <span className={`flex-shrink-0 rounded-md px-2 py-0.5 text-[9px] ${meeting.status === 'open' ? 'bg-cyan-500/10 text-cyan-300' : 'bg-slate-700/40 text-slate-400'}`}>
                        {meeting.status === 'open' ? 'فعال' : 'آرشیو'}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-600">
                      <span>{formatDate(meeting.meeting_date)}</span>
                      <span>{formatTime(meeting.start_time)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : <EmptyState text="جلسه‌ای ثبت نشده است" />}
          </Panel>

          <Panel title="تسک‌های مهم" subtitle="عقب‌مانده‌ها و اولویت‌های بالاتر در صدر فهرست" className="xl:col-span-3">
            {data.important_tasks.length ? (
              <div className="space-y-2">
                {data.important_tasks.map((task) => {
                  const isOverdue = task.dashboard_status === 'overdue';
                  return (
                    <div key={task.id} className="rounded-xl border border-slate-800/80 bg-slate-900/35 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-2 text-xs leading-5 text-slate-200">{task.title}</p>
                        <span className={`flex-shrink-0 rounded-md px-2 py-0.5 text-[9px] ${isOverdue ? 'bg-rose-500/10 text-rose-300' : task.priority === 'high' ? 'bg-amber-500/10 text-amber-300' : 'bg-slate-700/40 text-slate-400'}`}>
                          {isOverdue ? 'عقب‌مانده' : task.priority === 'high' ? 'فوری' : 'مهم'}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-600">
                        <span className="truncate">{task.assignee || 'بدون مسئول'}</span>
                        <span className="flex-shrink-0">{formatDate(task.due_local_date)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <EmptyState text="تسک مهم یا معوقی وجود ندارد" />}
          </Panel>

          <Panel title="برنامه امروز" subtitle="جلسات امروز بر اساس ساعت تهران" className="xl:col-span-3">
            {data.today_schedule.length ? (
              <div className="relative space-y-0 pr-4 before:absolute before:bottom-2 before:right-[5px] before:top-2 before:w-px before:bg-slate-700/80">
                {data.today_schedule.map((item, index) => (
                  <div key={item.id} className="relative pb-4 last:pb-0">
                    <span className={`absolute -right-4 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-[#071426] ${index % 4 === 0 ? 'bg-blue-400' : index % 4 === 1 ? 'bg-emerald-400' : index % 4 === 2 ? 'bg-violet-400' : 'bg-amber-400'}`} />
                    <div className="flex gap-3">
                      <span className="w-11 flex-shrink-0 text-xs font-semibold text-slate-400">{formatTime(item.start_time)}</span>
                      <div className="min-w-0">
                        <p className="truncate text-xs text-slate-200">{item.subject}</p>
                        <p className="mt-1 truncate text-[9px] text-slate-600">{item.is_online ? 'آنلاین' : item.location || 'محل تعیین نشده'}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <EmptyState text="برای امروز جلسه‌ای در تقویم نیست" />}
          </Panel>

          <Panel title="هشدارهای مهلت" subtitle="موارد معوق یا دارای سررسید تا ۱۰ روز آینده" className="xl:col-span-3">
            {data.deadline_alerts.length ? (
              <div className="space-y-2">
                {data.deadline_alerts.map((alert) => {
                  const overdue = alert.days_remaining < 0;
                  const today = alert.days_remaining === 0;
                  const badge = overdue ? `${nf.format(Math.abs(alert.days_remaining))} روز گذشته` : today ? 'امروز' : `${nf.format(alert.days_remaining)} روز`;
                  return (
                    <div key={`${alert.source}-${alert.id}`} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${overdue ? 'border-rose-500/20 bg-rose-500/[0.06]' : 'border-slate-800/80 bg-slate-900/35'}`}>
                      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${overdue ? 'bg-rose-500/10 text-rose-300' : alert.source === 'decision' ? 'bg-violet-500/10 text-violet-300' : 'bg-amber-500/10 text-amber-300'}`}>
                        {alert.source === 'decision' ? <Target className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[11px] text-slate-200">{alert.title}</p>
                        <p className="mt-0.5 text-[9px] text-slate-600">{alert.source === 'decision' ? 'مصوبه' : 'تسک'} · {formatDate(alert.due_date)}</p>
                      </div>
                      <span className={`flex-shrink-0 rounded-md px-2 py-1 text-[9px] ${overdue ? 'bg-rose-500/10 text-rose-300' : today ? 'bg-amber-500/10 text-amber-300' : 'bg-blue-500/10 text-blue-300'}`}>{badge}</span>
                    </div>
                  );
                })}
              </div>
            ) : <EmptyState text="هشدار مهلت فعالی وجود ندارد" />}
          </Panel>
        </div>

        <div className="grid gap-3 xl:grid-cols-12">
          <div className="relative overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-l from-violet-500/[0.08] via-slate-950/40 to-cyan-500/[0.05] p-4 xl:col-span-8">
            <div className="absolute -bottom-14 -left-10 h-36 w-36 rounded-full bg-violet-500/15 blur-2xl" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl border border-violet-400/20 bg-violet-500/10 shadow-[0_0_30px_rgba(124,58,237,0.18)]">
                <Sparkles className="h-7 w-7 text-violet-300" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-white">بینش‌های هوشمند مدیریتی</h3>
                <div className="mt-2 space-y-1.5">
                  {insights.map((insight, index) => (
                    <p key={index} className="flex gap-2 text-[11px] leading-5 text-slate-400">
                      <span className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-violet-400" />{insight}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:col-span-4 xl:grid-cols-3">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-center">
              <UsersRound className="mx-auto h-5 w-5 text-emerald-300" />
              <p className="mt-2 text-xl font-black text-white">{nf.format(stats.total_decisions)}</p>
              <p className="mt-1 text-[9px] text-slate-500">کل مصوبات</p>
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-center">
              <Gauge className="mx-auto h-5 w-5 text-amber-300" />
              <p className="mt-2 text-xl font-black text-white">{nf.format(stats.completion_rate)}٪</p>
              <p className="mt-1 text-[9px] text-slate-500">تکمیل به‌موقع</p>
            </div>
            <div className="col-span-2 rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] p-3 text-center sm:col-span-1">
              <TrendingUp className="mx-auto h-5 w-5 text-blue-300" />
              <p className="mt-2 text-xl font-black text-white">{nf.format(stats.active_meetings)}</p>
              <p className="mt-1 text-[9px] text-slate-500">جلسات فعال</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
