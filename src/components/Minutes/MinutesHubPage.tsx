import { useCallback, useEffect, useState } from 'react';
import type { ElementType } from 'react';
import {
  LayoutDashboard,
  FileText,
  ClipboardList,
  SquareCheck as DecisionIcon,
  TrendingUp,
  ChartBar as BarChart2,
  ChevronLeft,
  Loader as Loader2,
  CircleAlert as AlertCircle,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { PageId } from '../../app/navigation/useNavigation';

interface CardStats {
  total: number;
  open: number;
  closed: number;
}

interface HubCounts {
  minutes_unread: number;
  approvals_pending: number;
  my_decisions_unread: number;
  my_decisions_active: number;
  followup_actionable: number;
  minutes_total: number;
  minutes_open: number;
  minutes_closed: number;
  approvals_total: number;
  approvals_open: number;
  approvals_closed: number;
  my_decisions_total: number;
  my_decisions_open: number;
  my_decisions_closed: number;
  followup_total: number;
  followup_open: number;
  followup_closed: number;
  dashboard_minutes_total: number;
  dashboard_minutes_open: number;
  dashboard_minutes_closed: number;
  dashboard_decisions_total: number;
  dashboard_decisions_open: number;
  dashboard_decisions_closed: number;
  reports_total: number;
  reports_open: number;
  reports_closed: number;
}

type BadgeKey =
  | 'minutes_unread'
  | 'approvals_pending'
  | 'my_decisions_unread'
  | 'my_decisions_active'
  | 'followup_actionable';

type CardStatKey =
  | 'minutes'
  | 'approvals'
  | 'my_decisions'
  | 'followup'
  | 'dashboard_minutes'
  | 'dashboard_decisions'
  | 'reports';

type Tone = 'blue' | 'violet' | 'cyan' | 'green' | 'rose' | 'amber';

interface HubCard {
  id: PageId;
  title: string;
  description: string;
  icon: ElementType;
  tone: Tone;
  badgeKey?: BadgeKey;
  secondaryBadgeKey?: BadgeKey;
  statKey?: CardStatKey;
  statKeys?: CardStatKey[];
}

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
};

const CARDS: HubCard[] = [
  {
    id: 'minutes-approvals',
    title: 'کارتابل تأیید',
    description: 'صورت‌جلسات در انتظار بررسی و تأیید شما',
    icon: ClipboardList,
    tone: 'amber',
    badgeKey: 'approvals_pending',
    statKey: 'approvals',
  },
  {
    id: 'minutes-my-decisions',
    title: 'مصوبات من',
    description: 'مصوبات محول‌شده و وضعیت پیشرفت آن‌ها',
    icon: DecisionIcon,
    tone: 'cyan',
    badgeKey: 'my_decisions_unread',
    secondaryBadgeKey: 'my_decisions_active',
    statKey: 'my_decisions',
  },
  {
    id: 'minutes-followup',
    title: 'پیگیری مصوبات',
    description: 'پایش پیشرفت، سررسید و اقدامات نیازمند پیگیری',
    icon: TrendingUp,
    tone: 'rose',
    badgeKey: 'followup_actionable',
    statKey: 'followup',
  },
  {
    id: 'minutes',
    title: 'صورت‌جلسات',
    description: 'مشاهده، جستجو و مدیریت همه صورت‌جلسات',
    icon: FileText,
    tone: 'violet',
    badgeKey: 'minutes_unread',
    statKey: 'minutes',
  },
  {
    id: 'minutes-dashboard',
    title: 'داشبورد',
    description: 'نمای کلی وضعیت صورت‌جلسات و مصوبات',
    icon: LayoutDashboard,
    tone: 'blue',
    statKeys: ['dashboard_minutes', 'dashboard_decisions'],
  },
  {
    id: 'minutes-reports',
    title: 'گزارش‌ها',
    description: 'گزارش‌های تحلیلی و خروجی‌های مدیریتی',
    icon: BarChart2,
    tone: 'green',
    statKey: 'reports',
  },
];

const EMPTY_COUNTS: HubCounts = {
  minutes_unread: 0,
  approvals_pending: 0,
  my_decisions_unread: 0,
  my_decisions_active: 0,
  followup_actionable: 0,
  minutes_total: 0,
  minutes_open: 0,
  minutes_closed: 0,
  approvals_total: 0,
  approvals_open: 0,
  approvals_closed: 0,
  my_decisions_total: 0,
  my_decisions_open: 0,
  my_decisions_closed: 0,
  followup_total: 0,
  followup_open: 0,
  followup_closed: 0,
  dashboard_minutes_total: 0,
  dashboard_minutes_open: 0,
  dashboard_minutes_closed: 0,
  dashboard_decisions_total: 0,
  dashboard_decisions_open: 0,
  dashboard_decisions_closed: 0,
  reports_total: 0,
  reports_open: 0,
  reports_closed: 0,
};

const nf = new Intl.NumberFormat('fa-IR');
const timeFormatter = new Intl.DateTimeFormat('fa-IR', {
  hour: '2-digit',
  minute: '2-digit',
});

function getSingleStat(counts: HubCounts, key: CardStatKey): CardStats {
  switch (key) {
    case 'minutes':
      return { total: counts.minutes_total, open: counts.minutes_open, closed: counts.minutes_closed };
    case 'approvals':
      return { total: counts.approvals_total, open: counts.approvals_open, closed: counts.approvals_closed };
    case 'my_decisions':
      return { total: counts.my_decisions_total, open: counts.my_decisions_open, closed: counts.my_decisions_closed };
    case 'followup':
      return { total: counts.followup_total, open: counts.followup_open, closed: counts.followup_closed };
    case 'dashboard_minutes':
      return {
        total: counts.dashboard_minutes_total,
        open: counts.dashboard_minutes_open,
        closed: counts.dashboard_minutes_closed,
      };
    case 'dashboard_decisions':
      return {
        total: counts.dashboard_decisions_total,
        open: counts.dashboard_decisions_open,
        closed: counts.dashboard_decisions_closed,
      };
    case 'reports':
      return { total: counts.reports_total, open: counts.reports_open, closed: counts.reports_closed };
  }
}

function getCardStats(counts: HubCounts, card: HubCard): CardStats {
  if (card.statKeys) {
    return card.statKeys.reduce<CardStats>(
      (acc, key) => {
        const stat = getSingleStat(counts, key);
        return {
          total: acc.total + stat.total,
          open: acc.open + stat.open,
          closed: acc.closed + stat.closed,
        };
      },
      { total: 0, open: 0, closed: 0 },
    );
  }
  return card.statKey ? getSingleStat(counts, card.statKey) : { total: 0, open: 0, closed: 0 };
}

function getPrimaryBadgeLabel(card: HubCard): string {
  if (card.id === 'minutes-approvals') return 'نیازمند تأیید';
  if (card.id === 'minutes-followup') return 'نیازمند پیگیری';
  return 'جدید';
}

interface Props {
  onNavigate: (page: PageId) => void;
  visibleCards?: Set<PageId>;
  canCreateMinute?: boolean;
}

export function MinutesHubPage({ onNavigate, visibleCards, canCreateMinute = false }: Props) {
  const [counts, setCounts] = useState<HubCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchCounts = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      setFetchError(false);
      const { data, error } = await supabase.rpc('get_my_minutes_hub_counts');
      if (error) {
        console.error('[MinutesHub] count fetch failed', { code: error.code, message: error.message });
        setFetchError(true);
        return;
      }
      if (data) {
        const d = data as Record<string, number>;
        setCounts({
          minutes_unread: d.minutes_unread ?? 0,
          approvals_pending: d.approvals_pending ?? 0,
          my_decisions_unread: d.my_decisions_unread ?? 0,
          my_decisions_active: d.my_decisions_active ?? 0,
          followup_actionable: d.followup_actionable ?? 0,
          minutes_total: d.minutes_total ?? 0,
          minutes_open: d.minutes_open ?? 0,
          minutes_closed: d.minutes_closed ?? 0,
          approvals_total: d.approvals_total ?? 0,
          approvals_open: d.approvals_open ?? 0,
          approvals_closed: d.approvals_closed ?? 0,
          my_decisions_total: d.my_decisions_total ?? 0,
          my_decisions_open: d.my_decisions_open ?? 0,
          my_decisions_closed: d.my_decisions_closed ?? 0,
          followup_total: d.followup_total ?? 0,
          followup_open: d.followup_open ?? 0,
          followup_closed: d.followup_closed ?? 0,
          dashboard_minutes_total: d.dashboard_minutes_total ?? 0,
          dashboard_minutes_open: d.dashboard_minutes_open ?? 0,
          dashboard_minutes_closed: d.dashboard_minutes_closed ?? 0,
          dashboard_decisions_total: d.dashboard_decisions_total ?? 0,
          dashboard_decisions_open: d.dashboard_decisions_open ?? 0,
          dashboard_decisions_closed: d.dashboard_decisions_closed ?? 0,
          reports_total: d.reports_total ?? 0,
          reports_open: d.reports_open ?? 0,
          reports_closed: d.reports_closed ?? 0,
        });
        setLastUpdated(new Date());
      }
    } catch (err) {
      console.error('[MinutesHub] count fetch exception', err);
      setFetchError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchCounts();

    const handleFocus = () => void fetchCounts();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void fetchCounts();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchCounts]);

  const isVisible = (page: PageId) => !visibleCards || visibleCards.has(page);
  const cards = visibleCards ? CARDS.filter(card => visibleCards.has(card.id)) : CARDS;

  const kpis = [
    isVisible('minutes-approvals')
      ? { id: 'minutes-approvals' as PageId, title: 'نیازمند تأیید', value: counts.approvals_pending, sub: 'منتظر اقدام شما', icon: ClipboardList, tone: 'amber' as Tone }
      : null,
    isVisible('minutes-my-decisions')
      ? { id: 'minutes-my-decisions' as PageId, title: 'مصوبات فعال', value: counts.my_decisions_active, sub: 'در مسئولیت شما', icon: DecisionIcon, tone: 'cyan' as Tone }
      : null,
    isVisible('minutes-followup')
      ? { id: 'minutes-followup' as PageId, title: 'نیازمند پیگیری', value: counts.followup_actionable, sub: 'نیازمند توجه', icon: TrendingUp, tone: 'rose' as Tone }
      : null,
    isVisible('minutes')
      ? { id: 'minutes' as PageId, title: 'صورت‌جلسات باز', value: counts.minutes_open, sub: `از ${nf.format(counts.minutes_total)} صورت‌جلسه`, icon: FileText, tone: 'violet' as Tone }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <div
      className="relative overflow-hidden rounded-[28px] border border-slate-800/80 bg-[#06101f] p-3 text-slate-100 shadow-[0_28px_80px_rgba(2,6,23,0.35)] sm:p-5"
      dir="rtl"
    >
      <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-violet-600/10 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-32 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="relative z-10 space-y-4">
        <header className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1 text-[11px] font-semibold text-violet-300">
                <Sparkles className="h-3.5 w-3.5" /> مرکز عملیات جلسات
              </span>
              {!loading && !fetchError && (
                <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-[10px] text-slate-500">
                  آمار به‌روز
                </span>
              )}
            </div>
            <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">صورت‌جلسات و مصوبات</h1>
            <p className="mt-1 text-xs text-slate-500 sm:text-sm">مدیریت صورت‌جلسات، مصوبات و اقدامات در یک نمای یکپارچه</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
            {lastUpdated && (
              <div className="hidden rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2 text-left sm:block">
                <p className="text-[9px] text-slate-600">آخرین بروزرسانی</p>
                <p className="mt-0.5 text-[11px] text-slate-400">{timeFormatter.format(lastUpdated)}</p>
              </div>
            )}
            <button
              type="button"
              onClick={() => void fetchCounts(true)}
              disabled={refreshing}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2.5 text-xs font-semibold text-slate-300 transition hover:border-slate-600 hover:bg-slate-800/70 disabled:opacity-60"
              aria-label="بروزرسانی آمار"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">بروزرسانی</span>
            </button>
            {canCreateMinute && (
              <button
                type="button"
                onClick={() => onNavigate('minutes-new')}
                className="inline-flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/15 px-3.5 py-2.5 text-xs font-semibold text-violet-200 transition hover:bg-violet-500/25"
              >
                <Plus className="h-4 w-4" />
                ثبت صورت‌جلسه
              </button>
            )}
          </div>
        </header>

        {fetchError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-[11px] text-rose-200">
            <span className="inline-flex items-center gap-2">
              <AlertCircle className="h-4 w-4" /> دریافت آمار با خطا مواجه شد.
            </span>
            <button type="button" onClick={() => void fetchCounts(true)} className="font-semibold text-rose-50">
              تلاش مجدد
            </button>
          </div>
        )}

        {kpis.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {kpis.map(item => {
              const styles = toneClasses[item.tone];
              const Icon = item.icon;
              const hasAttention = !loading && item.value > 0 && (item.id === 'minutes-approvals' || item.id === 'minutes-followup');

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`relative min-w-0 overflow-hidden rounded-2xl border p-3.5 text-right shadow-[0_12px_40px_rgba(0,0,0,0.12)] transition hover:-translate-y-0.5 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-violet-500/30 ${styles.card} ${hasAttention ? 'ring-1 ring-rose-400/50' : ''}`}
                >
                  {hasAttention && <span className="absolute inset-y-0 right-0 w-1 bg-rose-400" />}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium text-slate-400">{item.title}</p>
                      <p className="mt-1.5 text-2xl font-black tracking-tight text-white">
                        {loading ? '—' : nf.format(item.value)}
                      </p>
                    </div>
                    <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ring-1 ${styles.icon}`}>
                      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-[18px] w-[18px]" />}
                    </div>
                  </div>
                  <p className={`mt-1.5 truncate text-[10px] ${styles.accent}`}>{item.sub}</p>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-end justify-between gap-3 pt-1">
          <div>
            <h2 className="text-sm font-bold text-slate-100 sm:text-base">بخش‌های صورت‌جلسات و مصوبات</h2>
            <p className="mt-0.5 text-[10px] text-slate-500 sm:text-[11px]">وضعیت هر بخش و موارد جدید در یک نگاه</p>
          </div>
          <span className="hidden text-[10px] text-slate-600 sm:block">{nf.format(cards.length)} بخش</span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {cards.map(card => {
            const styles = toneClasses[card.tone];
            const Icon = card.icon;
            const stats = getCardStats(counts, card);
            const primaryBadge = card.badgeKey ? counts[card.badgeKey] : 0;
            const secondaryBadge = card.secondaryBadgeKey ? counts[card.secondaryBadgeKey] : 0;
            const hasNew = !loading && primaryBadge > 0;

            return (
              <button
                key={card.id}
                type="button"
                onClick={() => onNavigate(card.id)}
                className={`group relative min-w-0 overflow-hidden rounded-2xl border p-4 text-right shadow-[0_14px_42px_rgba(0,0,0,0.14)] transition hover:-translate-y-0.5 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-violet-500/30 sm:p-5 ${styles.card} ${hasNew ? 'ring-1 ring-rose-400/50 shadow-[0_14px_42px_rgba(244,63,94,0.10)]' : ''}`}
                aria-label={`${card.title}؛ ${card.description}`}
              >
                {hasNew && <span className="absolute inset-y-0 right-0 w-1 bg-rose-400" />}

                <div className="flex items-start gap-3">
                  <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ring-1 ${styles.icon}`}>
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-100 sm:text-base">{card.title}</h3>
                          {hasNew && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-2.5 py-1 text-[9px] font-black text-rose-50 shadow-[0_4px_14px_rgba(244,63,94,0.35)]">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-50" />
                              {nf.format(primaryBadge)} {getPrimaryBadgeLabel(card)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-400 sm:text-xs">{card.description}</p>
                      </div>
                      <ChevronLeft className={`mt-1 h-5 w-5 flex-shrink-0 text-slate-600 transition-transform group-hover:-translate-x-1 ${hasNew ? 'text-rose-300' : ''}`} />
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {loading ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> در حال دریافت آمار
                        </span>
                      ) : (
                        <>
                          <span className="rounded-lg border border-slate-700/80 bg-slate-950/30 px-2.5 py-1 text-[10px] text-slate-400">
                            کل <strong className="font-bold text-slate-200">{nf.format(stats.total)}</strong>
                          </span>
                          <span className={`rounded-lg border border-slate-600/60 bg-slate-950/20 px-2.5 py-1 text-[10px] ${styles.accent}`}>
                            باز <strong className="font-bold">{nf.format(stats.open)}</strong>
                          </span>
                          <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-2.5 py-1 text-[10px] text-emerald-300">
                            بسته <strong className="font-bold">{nf.format(stats.closed)}</strong>
                          </span>
                          {secondaryBadge > 0 && (
                            <span className="rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-2.5 py-1 text-[10px] font-semibold text-cyan-200">
                              {nf.format(secondaryBadge)} فعال
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
