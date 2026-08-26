import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  ArrowUpLeft,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  FileCheck2,
  FileText,
  Gauge,
  ListChecks,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { MinutesBackButton } from './MinutesBackButton';
import { TableSkeleton } from './MinutesShared';

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

type Tone = 'violet' | 'slate' | 'amber' | 'blue' | 'rose' | 'orange';

type DistributionItem = {
  key: string;
  label: string;
  value: number;
  color: string;
};

const nf = new Intl.NumberFormat('fa-IR');
const pf = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });

const STATUS_LABELS: Record<string, string> = {
  draft: 'پیش‌نویس',
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

const MINUTE_COLORS: Record<string, string> = {
  draft: '#8b5cf6',
  pending_approval: '#f59e0b',
  changes_requested: '#fb7185',
  approved: '#3b82f6',
  published: '#10b981',
};

const DECISION_COLORS: Record<string, string> = {
  completed: '#10b981',
  in_progress: '#3b82f6',
  planned: '#8b5cf6',
  not_started: '#94a3b8',
  waiting_coordination: '#f59e0b',
  waiting_approval: '#f97316',
  stopped: '#ef4444',
};

const tone: Record<Tone, { border: string; icon: string; value: string; note: string; ring: string }> = {
  violet: {
    border: 'border-violet-200/80 dark:border-violet-800/60 hover:border-violet-300 dark:hover:border-violet-700',
    icon: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
    value: 'text-violet-700 dark:text-violet-300',
    note: 'text-violet-600 dark:text-violet-300',
    ring: '#8b5cf6',
  },
  slate: {
    border: 'border-slate-200/80 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600',
    icon: 'bg-slate-100 text-slate-600 dark:bg-slate-700/70 dark:text-slate-300',
    value: 'text-slate-800 dark:text-white',
    note: 'text-slate-500 dark:text-slate-400',
    ring: '#64748b',
  },
  amber: {
    border: 'border-amber-200/80 dark:border-amber-800/60 hover:border-amber-300 dark:hover:border-amber-700',
    icon: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
    value: 'text-amber-700 dark:text-amber-300',
    note: 'text-amber-600 dark:text-amber-300',
    ring: '#f59e0b',
  },
  blue: {
    border: 'border-blue-200/80 dark:border-blue-800/60 hover:border-blue-300 dark:hover:border-blue-700',
    icon: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
    value: 'text-blue-700 dark:text-blue-300',
    note: 'text-blue-600 dark:text-blue-300',
    ring: '#3b82f6',
  },
  rose: {
    border: 'border-rose-200/80 dark:border-rose-800/60 hover:border-rose-300 dark:hover:border-rose-700',
    icon: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
    value: 'text-rose-700 dark:text-rose-300',
    note: 'text-rose-600 dark:text-rose-300',
    ring: '#f43f5e',
  },
  orange: {
    border: 'border-orange-200/80 dark:border-orange-800/60 hover:border-orange-300 dark:hover:border-orange-700',
    icon: 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300',
    value: 'text-orange-700 dark:text-orange-300',
    note: 'text-orange-600 dark:text-orange-300',
    ring: '#f97316',
  },
};

function percent(value: number, total: number) {
  return total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0;
}

function StatCard({ label, value, note, icon: Icon, toneKey, progress, onClick }: {
  label: string;
  value: number;
  note: string;
  icon: LucideIcon;
  toneKey: Tone;
  progress: number;
  onClick?: () => void;
}) {
  const t = tone[toneKey];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`group min-w-0 rounded-2xl border bg-white/90 p-3.5 text-right shadow-[0_10px_35px_rgba(15,23,42,.05)] backdrop-blur transition-all duration-300 dark:bg-slate-900/65 dark:shadow-none ${t.border} ${onClick ? 'hover:-translate-y-1 hover:shadow-[0_18px_45px_rgba(15,23,42,.10)]' : 'cursor-default'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${t.icon}`}><Icon className="h-5 w-5" /></div>
        <div className="relative flex h-11 w-11 items-center justify-center rounded-full p-[3px]" style={{ background: `conic-gradient(${t.ring} ${progress}%, rgba(148,163,184,.18) ${progress}% 100%)` }}>
          <div className="flex h-full w-full items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-600 dark:bg-slate-900 dark:text-slate-300">{pf.format(progress)}٪</div>
        </div>
      </div>
      <p className="mt-4 text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className={`text-3xl font-black tracking-tight ${t.value}`}>{nf.format(value)}</p>
        {onClick && <ArrowUpLeft className="mb-1 h-3.5 w-3.5 text-slate-300 transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 dark:text-slate-600" />}
      </div>
      <p className={`mt-2 line-clamp-1 text-[10px] font-medium ${t.note}`}>{note}</p>
    </button>
  );
}

function Donut({ items, total, label }: { items: DistributionItem[]; total: number; label: string }) {
  let cursor = 0;
  const segments = items.map(item => {
    const start = cursor;
    cursor += total > 0 ? (item.value / total) * 360 : 0;
    return `${item.color} ${start}deg ${cursor}deg`;
  });
  const gradient = segments.length ? `conic-gradient(${segments.join(', ')})` : 'conic-gradient(#e2e8f0 0deg 360deg)';

  return (
    <div className="grid gap-5 sm:grid-cols-[150px_1fr] sm:items-center">
      <div className="mx-auto flex h-36 w-36 items-center justify-center rounded-full p-[13px] shadow-[0_14px_40px_rgba(15,23,42,.08)]" style={{ background: gradient }}>
        <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white dark:bg-slate-950">
          <span className="text-3xl font-black text-slate-900 dark:text-white">{nf.format(total)}</span>
          <span className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">{label}</span>
        </div>
      </div>
      <div className="space-y-2.5">
        {items.length === 0 ? <p className="text-center text-xs text-slate-400">داده‌ای برای نمایش وجود ندارد</p> : items.map(item => (
          <div key={item.key} className="flex items-center justify-between gap-3 rounded-xl px-2 py-1.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
              <span className="truncate text-xs text-slate-600 dark:text-slate-300">{item.label}</span>
            </div>
            <span className="flex-shrink-0 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{nf.format(item.value)} ({pf.format(percent(item.value, total))}٪)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Panel({ title, subtitle, icon: Icon, iconClass, onViewAll, children }: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  iconClass: string;
  onViewAll?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="h-full min-w-0 rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-[0_14px_45px_rgba(15,23,42,.05)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/65 dark:shadow-none sm:p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl ${iconClass}`}><Icon className="h-4 w-4" /></div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
            <p className="mt-1 line-clamp-1 text-[10px] text-slate-400">{subtitle}</p>
          </div>
        </div>
        {onViewAll && (
          <button type="button" onClick={onViewAll} className="inline-flex flex-shrink-0 items-center gap-1 rounded-xl border border-slate-200 px-2.5 py-1.5 text-[11px] font-medium text-blue-600 transition hover:border-blue-200 hover:bg-blue-50 dark:border-slate-700 dark:text-blue-300 dark:hover:border-blue-800 dark:hover:bg-blue-950/30">همه <ChevronLeft className="h-3.5 w-3.5" /></button>
        )}
      </div>
      {children}
    </section>
  );
}

export function MinutesDashboardPage({ onNavigate }: Props) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (isRefresh = false) => {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_minutes_dashboard_stats');
      if (rpcError) throw new Error(rpcError.message);
      setStats(data as DashboardStats);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'بارگذاری داشبورد ناموفق بود.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const derived = useMemo(() => {
    if (!stats) return null;
    const minuteDistribution = Object.entries(stats.status_counts || {}).filter(([, v]) => v > 0).map(([key, value]) => ({ key, value, label: STATUS_LABELS[key] || key, color: MINUTE_COLORS[key] || '#64748b' }));
    const decisionDistribution = Object.entries(stats.decision_status_counts || {}).filter(([, v]) => v > 0).map(([key, value]) => ({ key, value, label: STATUS_LABELS[key] || key, color: DECISION_COLORS[key] || '#64748b' }));
    const totalDecisions = decisionDistribution.reduce((sum, item) => sum + item.value, 0);
    const insights = [
      stats.overdue_decisions > 0 ? { title: `${nf.format(stats.overdue_decisions)} مصوبه عقب‌مانده نیازمند پیگیری است`, description: 'موارد عبورکرده از مهلت را در اولویت پیگیری قرار دهید.', toneKey: 'rose' as Tone, icon: AlertCircle, action: 'پیگیری مصوبات', page: 'minutes-followup' } : null,
      stats.pending_my_approval > 0 ? { title: `${nf.format(stats.pending_my_approval)} صورت‌جلسه منتظر تأیید شماست`, description: 'کارتابل تأیید را بررسی کنید تا فرایند انتشار متوقف نماند.', toneKey: 'amber' as Tone, icon: Clock3, action: 'بررسی کارتابل', page: 'minutes-approvals' } : null,
      stats.draft > 0 ? { title: `${nf.format(stats.draft)} پیش‌نویس هنوز نهایی نشده است`, description: 'پیش‌نویس‌های باز را تکمیل یا برای تأیید ارسال کنید.', toneKey: 'violet' as Tone, icon: FileText, action: 'مشاهده پیش‌نویس‌ها', page: 'minutes' } : null,
      stats.decisions_near_deadline > 0 ? { title: `${nf.format(stats.decisions_near_deadline)} مصوبه به سررسید نزدیک است`, description: 'موارد نزدیک به موعد را پیش از تبدیل‌شدن به تأخیر بررسی کنید.', toneKey: 'orange' as Tone, icon: Zap, action: 'مشاهده مصوبات', page: 'minutes-my-decisions' } : null,
    ].filter(Boolean) as Array<{ title: string; description: string; toneKey: Tone; icon: LucideIcon; action: string; page: string }>;
    return { minuteDistribution, decisionDistribution, totalDecisions, insights };
  }, [stats]);

  if (loading) return (
    <div dir="rtl" className="space-y-4">
      <MinutesBackButton onNavigate={onNavigate} target="minutes-hub" label="بازگشت به صورت‌جلسات و مصوبات" />
      <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-white via-blue-50/40 to-violet-50/50 p-5 dark:border-slate-800 dark:from-slate-950 dark:via-slate-950 dark:to-violet-950/20">
        <div className="mb-5 h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />
        <TableSkeleton rows={4} />
      </div>
    </div>
  );

  if (error) return (
    <div dir="rtl" className="space-y-4">
      <MinutesBackButton onNavigate={onNavigate} target="minutes-hub" label="بازگشت به صورت‌جلسات و مصوبات" />
      <div className="flex min-h-[45vh] flex-col items-center justify-center gap-4 rounded-3xl border border-rose-200 bg-rose-50/70 p-6 text-center dark:border-rose-900/50 dark:bg-rose-950/20">
        <AlertCircle className="h-10 w-10 text-rose-500" />
        <div><h2 className="font-bold text-slate-900 dark:text-white">داشبورد بارگذاری نشد</h2><p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{error}</p></div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-rose-500"><RefreshCw className="h-4 w-4" /> تلاش مجدد</button>
      </div>
    </div>
  );

  if (!stats || !derived) return null;

  const totalDecisions = Math.max(derived.totalDecisions, stats.open_decisions, stats.overdue_decisions);
  const cards = [
    { label: 'کل صورت‌جلسات', value: stats.total_minutes, note: `${nf.format(stats.created_last_30)} مورد در ۳۰ روز اخیر`, icon: FileCheck2, toneKey: 'violet' as Tone, progress: stats.total_minutes ? 100 : 0, onClick: () => onNavigate('minutes') },
    { label: 'پیش‌نویس', value: stats.draft, note: stats.draft ? 'نیازمند تکمیل یا ارسال' : 'پیش‌نویس بازی ندارید', icon: FileText, toneKey: 'slate' as Tone, progress: percent(stats.draft, stats.total_minutes), onClick: () => onNavigate('minutes') },
    { label: 'منتظر تأیید من', value: stats.pending_my_approval, note: stats.pending_my_approval ? 'نیازمند اقدام شما' : 'اقدام فوری ندارید', icon: Clock3, toneKey: 'amber' as Tone, progress: percent(stats.pending_my_approval, stats.total_minutes), onClick: () => onNavigate('minutes-approvals') },
    { label: 'مصوبات فعال', value: stats.open_decisions, note: stats.open_decisions ? 'در جریان اجرا و پیگیری' : 'مصوبه فعالی وجود ندارد', icon: TrendingUp, toneKey: 'blue' as Tone, progress: percent(stats.open_decisions, totalDecisions), onClick: () => onNavigate('minutes-my-decisions') },
    { label: 'عقب‌مانده', value: stats.overdue_decisions, note: stats.overdue_decisions ? 'نیازمند پیگیری فوری' : 'همه موارد در زمان‌بندی‌اند', icon: AlertCircle, toneKey: 'rose' as Tone, progress: percent(stats.overdue_decisions, totalDecisions), onClick: () => onNavigate('minutes-followup') },
    { label: 'نزدیک سررسید', value: stats.decisions_near_deadline, note: stats.decisions_near_deadline ? 'پیش از عبور از مهلت بررسی شود' : 'سررسید نزدیکی وجود ندارد', icon: Zap, toneKey: 'orange' as Tone, progress: percent(stats.decisions_near_deadline, Math.max(1, stats.open_decisions)), onClick: () => onNavigate('minutes-my-decisions') },
  ];

  const quickActions = [
    { label: 'ایجاد صورت‌جلسه', description: 'ثبت سند جدید', icon: Plus, page: 'minutes-new', primary: true },
    { label: 'کارتابل تأیید', description: `${nf.format(stats.pending_my_approval)} مورد منتظر`, icon: CheckCircle2, page: 'minutes-approvals' },
    { label: 'مصوبات من', description: `${nf.format(stats.open_decisions)} مورد فعال`, icon: Target, page: 'minutes-my-decisions' },
    { label: 'گزارش‌ها', description: 'تحلیل و خروجی', icon: BarChart3, page: 'minutes-reports' },
  ];

  return (
    <div dir="rtl" className="space-y-4 pb-4">
      <MinutesBackButton onNavigate={onNavigate} target="minutes-hub" label="بازگشت به صورت‌جلسات و مصوبات" />

      <div className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-gradient-to-br from-white via-blue-50/45 to-violet-50/55 p-3 shadow-[0_24px_70px_rgba(15,23,42,.07)] dark:border-slate-800 dark:from-[#06101f] dark:via-[#071426] dark:to-[#130b28] dark:shadow-[0_24px_70px_rgba(0,0,0,.24)] sm:p-5">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-blue-400/10 blur-3xl dark:bg-cyan-500/10" />
        <div className="pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full bg-violet-400/10 blur-3xl dark:bg-violet-600/10" />

        <div className="relative z-10 space-y-4">
          <header className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
            <div className="min-w-0">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-600 dark:border-violet-800/70 dark:bg-violet-500/10 dark:text-violet-300"><Sparkles className="h-3.5 w-3.5" /> مرکز کنترل صورت‌جلسات</span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-medium text-emerald-600 dark:border-emerald-800/70 dark:bg-emerald-500/10 dark:text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> داده زنده</span>
              </div>
              <h1 className="text-xl font-black tracking-tight text-slate-950 dark:text-white sm:text-2xl">داشبورد صورت‌جلسات</h1>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 sm:text-sm">نمای کلی وضعیت صورت‌جلسات، مصوبات و موارد نیازمند اقدام شما</p>
            </div>
            <div className="mobile-scroll-actions flex items-center gap-2 self-stretch overflow-x-auto pb-1 lg:self-auto lg:overflow-visible lg:pb-0">
              <button type="button" onClick={() => void load(true)} disabled={refreshing} className="inline-flex h-11 flex-shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 text-xs font-medium text-slate-600 transition hover:bg-white disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> بروزرسانی</button>
              <button type="button" onClick={() => onNavigate('calendar')} className="inline-flex h-11 flex-shrink-0 items-center gap-2 rounded-xl bg-gradient-to-l from-blue-600 to-indigo-600 px-4 text-xs font-semibold text-white shadow-[0_10px_30px_rgba(37,99,235,.24)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_35px_rgba(37,99,235,.3)]"><CalendarDays className="h-4 w-4" /> انتخاب جلسه از تقویم</button>
            </div>
          </header>

          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
            {cards.map(card => <StatCard key={card.label} {...card} />)}
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <Panel title="توزیع وضعیت مصوبات" subtitle="نمای تجمعی وضعیت اجرای مصوبات" icon={BarChart3} iconClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" onViewAll={() => onNavigate('minutes-my-decisions')}>
              <Donut items={derived.decisionDistribution} total={derived.totalDecisions} label="مصوبه" />
            </Panel>
            <Panel title="توزیع وضعیت صورت‌جلسات" subtitle="پیش‌نویس، تأیید و انتشار" icon={FileCheck2} iconClass="bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300" onViewAll={() => onNavigate('minutes')}>
              <Donut items={derived.minuteDistribution} total={stats.total_minutes} label="صورت‌جلسه" />
            </Panel>
            <Panel title="عملکرد ۳۰ روز اخیر" subtitle="نبض ثبت و پیگیری اسناد در یک ماه گذشته" icon={Gauge} iconClass="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300">
              <div className="flex min-h-[154px] flex-col justify-center gap-4">
                <div className="flex items-center justify-between gap-4">
                  <div><p className="text-4xl font-black text-violet-600 dark:text-violet-300">{nf.format(stats.created_last_30)}</p><p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">صورت‌جلسه ایجادشده</p></div>
                  <div className="flex h-20 w-20 items-center justify-center rounded-full border-[7px] border-violet-100 bg-violet-50 text-violet-600 shadow-inner dark:border-violet-500/15 dark:bg-violet-500/10 dark:text-violet-300"><CalendarDays className="h-7 w-7" /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60"><p className="text-lg font-bold text-slate-800 dark:text-white">{nf.format(stats.published)}</p><p className="text-[9px] text-slate-400">منتشرشده</p></div>
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60"><p className="text-lg font-bold text-slate-800 dark:text-white">{nf.format(stats.approved)}</p><p className="text-[9px] text-slate-400">تأییدشده</p></div>
                </div>
              </div>
            </Panel>
          </div>

          <div className="grid gap-3 xl:grid-cols-12">
            <section className="rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-[0_14px_45px_rgba(15,23,42,.05)] dark:border-slate-800 dark:bg-slate-900/65 dark:shadow-none sm:p-5 xl:col-span-7">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5"><div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300"><Zap className="h-4 w-4" /></div><div><h2 className="text-sm font-bold text-slate-900 dark:text-white">اقدامات پیشنهادی</h2><p className="mt-0.5 text-[10px] text-slate-400">اولویت‌های تولیدشده از وضعیت زنده داشبورد</p></div></div>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{nf.format(derived.insights.length)} مورد</span>
              </div>
              {derived.insights.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {derived.insights.map(item => {
                    const t = tone[item.toneKey];
                    const Icon = item.icon;
                    return <button key={item.title} type="button" onClick={() => onNavigate(item.page)} className={`group flex min-w-0 items-start gap-3 rounded-2xl border p-3 text-right transition hover:-translate-y-0.5 hover:shadow-md ${t.border}`}><div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${t.icon}`}><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="line-clamp-1 text-xs font-bold text-slate-800 dark:text-slate-100">{item.title}</p><p className="mt-1 line-clamp-2 text-[10px] leading-5 text-slate-500 dark:text-slate-400">{item.description}</p><span className={`mt-2 inline-flex items-center gap-1 text-[10px] font-semibold ${t.note}`}>{item.action}<ChevronLeft className="h-3 w-3 transition-transform group-hover:-translate-x-0.5" /></span></div></button>;
                  })}
                </div>
              ) : (
                <div className="flex min-h-[130px] flex-col items-center justify-center rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/50 text-center dark:border-emerald-900/60 dark:bg-emerald-950/10"><CheckCircle2 className="h-8 w-8 text-emerald-500" /><p className="mt-2 text-sm font-bold text-emerald-700 dark:text-emerald-300">همه‌چیز تحت کنترل است</p><p className="mt-1 text-[10px] text-emerald-600/70 dark:text-emerald-400/70">فعلاً مورد فوری برای اقدام شما وجود ندارد.</p></div>
              )}
            </section>

            <section className="rounded-3xl border border-slate-200/80 bg-white/90 p-4 shadow-[0_14px_45px_rgba(15,23,42,.05)] dark:border-slate-800 dark:bg-slate-900/65 dark:shadow-none sm:p-5 xl:col-span-5">
              <div className="mb-4 flex items-center gap-2.5"><div className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300"><TrendingUp className="h-4 w-4" /></div><div><h2 className="text-sm font-bold text-slate-900 dark:text-white">واحدهای نیازمند توجه</h2><p className="mt-0.5 text-[10px] text-slate-400">بیشترین مصوبات باز به تفکیک واحد</p></div></div>
              {stats.top_units.length ? (
                <div className="space-y-3">
                  {stats.top_units.slice(0, 5).map((unit, index) => {
                    const maxOpen = Math.max(1, ...stats.top_units.map(x => x.open_decisions));
                    return <div key={`${unit.unit}-${index}`}><div className="mb-1.5 flex items-center justify-between gap-3 text-[11px]"><span className="min-w-0 truncate font-medium text-slate-700 dark:text-slate-300" title={unit.unit}>{unit.unit}</span><span className="flex-shrink-0 text-slate-400">{nf.format(unit.open_decisions)} باز</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-l from-cyan-400 via-blue-500 to-violet-500 transition-all duration-700" style={{ width: `${Math.max(6, percent(unit.open_decisions, maxOpen))}%` }} /></div></div>;
                  })}
                </div>
              ) : <div className="flex min-h-[130px] items-center justify-center text-xs text-slate-400">داده‌ای برای واحدهای سازمانی وجود ندارد.</div>}
            </section>
          </div>

          <section className="rounded-3xl border border-slate-200/80 bg-white/80 p-3 shadow-[0_12px_35px_rgba(15,23,42,.04)] dark:border-slate-800 dark:bg-slate-900/55 dark:shadow-none sm:p-4">
            <div className="mb-3 flex items-center gap-2"><ListChecks className="h-4 w-4 text-blue-500" /><h2 className="text-xs font-bold text-slate-800 dark:text-slate-200">دسترسی سریع</h2></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {quickActions.map(({ label, description, icon: Icon, page, primary }) => (
                <button key={label} type="button" onClick={() => onNavigate(page)} className={`group flex min-w-0 items-center gap-3 rounded-2xl border p-3 text-right shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${primary ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-500' : 'border-slate-200/70 bg-white text-slate-700 hover:bg-blue-50 dark:border-slate-700/70 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-blue-950/20'}`}><div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-black/5 dark:bg-white/10"><Icon className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-xs font-bold">{label}</p><p className="mt-0.5 truncate text-[9px] opacity-65">{description}</p></div></button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
