import { useCallback, useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  ArrowUpLeft,
  Clock3,
  FileCheck2,
  FileText,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface DashboardStats {
  total_minutes: number;
  draft: number;
  open_decisions: number;
  overdue_decisions: number;
  pending_approval: number;
  pending_my_approval: number;
  created_last_30: number;
  decisions_near_deadline: number;
  decision_status_counts: Record<string, number>;
}

type Tone = 'violet' | 'slate' | 'amber' | 'blue' | 'rose' | 'orange';

const nf = new Intl.NumberFormat('fa-IR');
const pf = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });

const tone: Record<Tone, { border: string; icon: string; value: string; note: string; ring: string }> = {
  violet: { border: 'border-violet-200/80 dark:border-violet-800/60 hover:border-violet-300 dark:hover:border-violet-700', icon: 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300', value: 'text-violet-700 dark:text-violet-300', note: 'text-violet-600 dark:text-violet-300', ring: '#8b5cf6' },
  slate: { border: 'border-slate-200/80 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600', icon: 'bg-slate-100 text-slate-600 dark:bg-slate-700/70 dark:text-slate-300', value: 'text-slate-800 dark:text-white', note: 'text-slate-500 dark:text-slate-400', ring: '#64748b' },
  amber: { border: 'border-amber-200/80 dark:border-amber-800/60 hover:border-amber-300 dark:hover:border-amber-700', icon: 'bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300', value: 'text-amber-700 dark:text-amber-300', note: 'text-amber-600 dark:text-amber-300', ring: '#f59e0b' },
  blue: { border: 'border-blue-200/80 dark:border-blue-800/60 hover:border-blue-300 dark:hover:border-blue-700', icon: 'bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300', value: 'text-blue-700 dark:text-blue-300', note: 'text-blue-600 dark:text-blue-300', ring: '#3b82f6' },
  rose: { border: 'border-rose-200/80 dark:border-rose-800/60 hover:border-rose-300 dark:hover:border-rose-700', icon: 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300', value: 'text-rose-700 dark:text-rose-300', note: 'text-rose-600 dark:text-rose-300', ring: '#f43f5e' },
  orange: { border: 'border-orange-200/80 dark:border-orange-800/60 hover:border-orange-300 dark:hover:border-orange-700', icon: 'bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300', value: 'text-orange-700 dark:text-orange-300', note: 'text-orange-600 dark:text-orange-300', ring: '#f97316' },
};

function percent(value: number, total: number) {
  return total > 0 ? Math.max(0, Math.min(100, Math.round((value / total) * 100))) : 0;
}

function StatCard({ label, value, note, icon: Icon, toneKey, progress, onClick }: {
  label: string;
  value: number | null;
  note: string;
  icon: LucideIcon;
  toneKey: Tone;
  progress: number;
  onClick: () => void;
}) {
  const t = tone[toneKey];
  return (
    <button type="button" onClick={onClick} className={`group min-w-0 rounded-2xl border bg-white/90 p-3.5 text-right shadow-[0_10px_35px_rgba(15,23,42,.05)] backdrop-blur transition-all duration-300 dark:bg-slate-900/65 dark:shadow-none ${t.border} hover:-translate-y-1 hover:shadow-[0_18px_45px_rgba(15,23,42,.10)]`}>
      <div className="flex items-start justify-between gap-2">
        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${t.icon}`}><Icon className="h-5 w-5" /></div>
        <div className="relative flex h-11 w-11 items-center justify-center rounded-full p-[3px]" style={{ background: `conic-gradient(${t.ring} ${progress}%, rgba(148,163,184,.18) ${progress}% 100%)` }}>
          <div className="flex h-full w-full items-center justify-center rounded-full bg-white text-[10px] font-bold text-slate-600 dark:bg-slate-900 dark:text-slate-300">{pf.format(progress)}٪</div>
        </div>
      </div>
      <p className="mt-4 text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className={`text-3xl font-black tracking-tight ${t.value}`}>{value == null ? '—' : nf.format(value)}</p>
        <ArrowUpLeft className="mb-1 h-3.5 w-3.5 text-slate-300 transition-transform group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 dark:text-slate-600" />
      </div>
      <p className={`mt-2 line-clamp-1 text-[10px] font-medium ${t.note}`}>{note}</p>
    </button>
  );
}

export type ManagementDashboardFilterTarget = {
  tab: 'minutes' | 'decisions' | 'tasks';
  view: string;
  label: string;
};

export function ManagementMinutesOverview({ onFilter }: { onFilter: (target: ManagementDashboardFilterTarget) => void }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_management_minutes_dashboard_stats_v1');
      if (error) throw error;
      setStats(data as DashboardStats);
    } catch (error) {
      console.error('[ManagementMinutesOverview] load failed', error);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const decisionTotal = stats
    ? Math.max(Object.values(stats.decision_status_counts || {}).reduce((sum, value) => sum + Number(value || 0), 0), stats.open_decisions, stats.overdue_decisions)
    : 0;
  const cards = [
    { label: 'کل صورت‌جلسات', value: stats?.total_minutes ?? null, note: stats ? `${nf.format(stats.created_last_30)} مورد در ۳۰ روز اخیر` : 'در حال دریافت آمار', icon: FileCheck2, toneKey: 'violet' as Tone, progress: stats?.total_minutes ? 100 : 0, target: { tab: 'minutes', view: 'all', label: 'کل صورت‌جلسات زیرمجموعه' } as ManagementDashboardFilterTarget },
    { label: 'پیش‌نویس', value: stats?.draft ?? null, note: stats?.draft ? 'نیازمند تکمیل یا ارسال' : stats ? 'پیش‌نویس بازی ندارید' : 'در حال دریافت آمار', icon: FileText, toneKey: 'slate' as Tone, progress: stats ? percent(stats.draft, stats.total_minutes) : 0, target: { tab: 'minutes', view: 'draft', label: 'پیش‌نویس‌های زیرمجموعه' } as ManagementDashboardFilterTarget },
    { label: 'منتظر تأیید', value: stats?.pending_approval ?? null, note: stats?.pending_approval ? 'در انتظار تکمیل فرآیند تأیید' : stats ? 'موردی در انتظار تأیید نیست' : 'در حال دریافت آمار', icon: Clock3, toneKey: 'amber' as Tone, progress: stats ? percent(stats.pending_approval, stats.total_minutes) : 0, target: { tab: 'minutes', view: 'pending_approval', label: 'صورت‌جلسات منتظر تأیید زیرمجموعه' } as ManagementDashboardFilterTarget },
    { label: 'مصوبات فعال', value: stats?.open_decisions ?? null, note: stats?.open_decisions ? 'در جریان اجرا و پیگیری' : stats ? 'مصوبه فعالی وجود ندارد' : 'در حال دریافت آمار', icon: TrendingUp, toneKey: 'blue' as Tone, progress: stats ? percent(stats.open_decisions, decisionTotal) : 0, target: { tab: 'decisions', view: 'active', label: 'مصوبات فعال زیرمجموعه' } as ManagementDashboardFilterTarget },
    { label: 'عقب‌مانده', value: stats?.overdue_decisions ?? null, note: stats?.overdue_decisions ? 'نیازمند پیگیری فوری' : stats ? 'همه موارد در زمان‌بندی‌اند' : 'در حال دریافت آمار', icon: AlertCircle, toneKey: 'rose' as Tone, progress: stats ? percent(stats.overdue_decisions, decisionTotal) : 0, target: { tab: 'decisions', view: 'overdue', label: 'مصوبات عقب‌مانده زیرمجموعه' } as ManagementDashboardFilterTarget },
    { label: 'نزدیک سررسید', value: stats?.decisions_near_deadline ?? null, note: stats?.decisions_near_deadline ? 'پیش از عبور از مهلت بررسی شود' : stats ? 'سررسید نزدیکی وجود ندارد' : 'در حال دریافت آمار', icon: Zap, toneKey: 'orange' as Tone, progress: stats ? percent(stats.decisions_near_deadline, Math.max(1, stats.open_decisions)) : 0, target: { tab: 'decisions', view: 'near_deadline', label: 'مصوبات نزدیک سررسید زیرمجموعه' } as ManagementDashboardFilterTarget },
  ];

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-gradient-to-br from-white via-blue-50/45 to-violet-50/55 p-3 shadow-[0_24px_70px_rgba(15,23,42,.07)] dark:border-slate-800 dark:from-[#06101f] dark:via-[#071426] dark:to-[#130b28] dark:shadow-[0_24px_70px_rgba(0,0,0,.24)] sm:p-5" dir="rtl">
      <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-blue-400/10 blur-3xl dark:bg-cyan-500/10" />
      <div className="pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full bg-violet-400/10 blur-3xl dark:bg-violet-600/10" />
      <div className="relative z-10">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
          {cards.map(card => <StatCard key={card.label} label={card.label} value={card.value} note={card.note} icon={card.icon} toneKey={card.toneKey} progress={card.progress} onClick={() => onFilter(card.target)} />)}
        </div>
      </div>
    </section>
  );
}
