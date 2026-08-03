import { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, FileText, ClipboardList, SquareCheck as DecisionIcon, TrendingUp, ChartBar as BarChart2, ChevronLeft, Loader as Loader2, CircleAlert as AlertCircle } from 'lucide-react';
import { PageHeader } from './MinutesShared';
import { supabase } from '../../lib/supabase';
import type { PageId } from '../../app/navigation/useNavigation';

interface CardStats {
  total: number;
  open: number;
  closed: number;
}

interface HubCounts {
  // Unread/pending notification badges (preserved separately)
  minutes_unread: number;
  approvals_pending: number;
  my_decisions_unread: number;
  my_decisions_active: number;
  followup_actionable: number;
  // Per-card total/open/closed
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

type BadgeKey = 'minutes_unread' | 'approvals_pending' | 'my_decisions_unread' | 'my_decisions_active' | 'followup_actionable';

type CardStatKey =
  | 'minutes'
  | 'approvals'
  | 'my_decisions'
  | 'followup'
  | 'dashboard_minutes'
  | 'dashboard_decisions'
  | 'reports';

interface HubCard {
  id: PageId;
  title: string;
  description: string;
  icon: typeof LayoutDashboard;
  color: string;
  bgColor: string;
  badgeKey?: BadgeKey;
  secondaryBadgeKey?: BadgeKey;
  statKey?: CardStatKey;
  /** When statKey covers two entities, show combined stats. */
  statKeys?: CardStatKey[];
}

const CARDS: HubCard[] = [
  {
    id: 'minutes-dashboard',
    title: 'داشبورد',
    description: 'خلاصه وضعیت صورت‌جلسات و مصوبات',
    icon: LayoutDashboard,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    statKeys: ['dashboard_minutes', 'dashboard_decisions'],
  },
  {
    id: 'minutes',
    title: 'صورت‌جلسات',
    description: 'فهرست تمام صورت‌جلسات',
    icon: FileText,
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-50 dark:bg-indigo-900/20',
    badgeKey: 'minutes_unread',
    statKey: 'minutes',
  },
  {
    id: 'minutes-approvals',
    title: 'کارتابل تأیید',
    description: 'صورت‌جلسات در انتظار تأیید شما',
    icon: ClipboardList,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    badgeKey: 'approvals_pending',
    statKey: 'approvals',
  },
  {
    id: 'minutes-my-decisions',
    title: 'مصوبات من',
    description: 'مصوبات محول‌شده به شما',
    icon: DecisionIcon,
    color: 'text-teal-600 dark:text-teal-400',
    bgColor: 'bg-teal-50 dark:bg-teal-900/20',
    badgeKey: 'my_decisions_unread',
    secondaryBadgeKey: 'my_decisions_active',
    statKey: 'my_decisions',
  },
  {
    id: 'minutes-followup',
    title: 'پیگیری مصوبات',
    description: 'پایش پیشرفت و سررسید مصوبات',
    icon: TrendingUp,
    color: 'text-rose-600 dark:text-rose-400',
    bgColor: 'bg-rose-50 dark:bg-rose-900/20',
    badgeKey: 'followup_actionable',
    statKey: 'followup',
  },
  {
    id: 'minutes-reports',
    title: 'گزارش‌ها',
    description: 'گزارش‌های تحلیلی و خروجی',
    icon: BarChart2,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    statKey: 'reports',
  },
];

const EMPTY_COUNTS: HubCounts = {
  minutes_unread: 0,
  approvals_pending: 0,
  my_decisions_unread: 0,
  my_decisions_active: 0,
  followup_actionable: 0,
  minutes_total: 0, minutes_open: 0, minutes_closed: 0,
  approvals_total: 0, approvals_open: 0, approvals_closed: 0,
  my_decisions_total: 0, my_decisions_open: 0, my_decisions_closed: 0,
  followup_total: 0, followup_open: 0, followup_closed: 0,
  dashboard_minutes_total: 0, dashboard_minutes_open: 0, dashboard_minutes_closed: 0,
  dashboard_decisions_total: 0, dashboard_decisions_open: 0, dashboard_decisions_closed: 0,
  reports_total: 0, reports_open: 0, reports_closed: 0,
};

function toPersianDigits(n: number): string {
  return n.toLocaleString('fa-IR');
}

function formatBadge(n: number): string | null {
  if (n <= 0) return null;
  if (n > 99) return '۹۹+';
  return toPersianDigits(n);
}

const ARIA_LABELS: Record<BadgeKey, string> = {
  minutes_unread: 'اعلان جدید',
  approvals_pending: 'مورد نیازمند تأیید',
  my_decisions_unread: 'اعلان جدید',
  my_decisions_active: 'مصوبه فعال',
  followup_actionable: 'مصوبه نیازمند پیگیری',
};

function getCardStats(counts: HubCounts, card: HubCard): CardStats {
  if (card.statKeys) {
    let total = 0, open = 0, closed = 0;
    for (const sk of card.statKeys) {
      const s = getSingleStat(counts, sk);
      total += s.total;
      open += s.open;
      closed += s.closed;
    }
    return { total, open, closed };
  }
  if (card.statKey) return getSingleStat(counts, card.statKey);
  return { total: 0, open: 0, closed: 0 };
}

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
      return { total: counts.dashboard_minutes_total, open: counts.dashboard_minutes_open, closed: counts.dashboard_minutes_closed };
    case 'dashboard_decisions':
      return { total: counts.dashboard_decisions_total, open: counts.dashboard_decisions_open, closed: counts.dashboard_decisions_closed };
    case 'reports':
      return { total: counts.reports_total, open: counts.reports_open, closed: counts.reports_closed };
  }
}

interface Props {
  onNavigate: (page: PageId) => void;
  visibleCards?: Set<PageId>;
}

export function MinutesHubPage({ onNavigate, visibleCards }: Props) {
  const [counts, setCounts] = useState<HubCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const fetchCounts = useCallback(async () => {
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
          minutes_total: d.minutes_total ?? 0, minutes_open: d.minutes_open ?? 0, minutes_closed: d.minutes_closed ?? 0,
          approvals_total: d.approvals_total ?? 0, approvals_open: d.approvals_open ?? 0, approvals_closed: d.approvals_closed ?? 0,
          my_decisions_total: d.my_decisions_total ?? 0, my_decisions_open: d.my_decisions_open ?? 0, my_decisions_closed: d.my_decisions_closed ?? 0,
          followup_total: d.followup_total ?? 0, followup_open: d.followup_open ?? 0, followup_closed: d.followup_closed ?? 0,
          dashboard_minutes_total: d.dashboard_minutes_total ?? 0, dashboard_minutes_open: d.dashboard_minutes_open ?? 0, dashboard_minutes_closed: d.dashboard_minutes_closed ?? 0,
          dashboard_decisions_total: d.dashboard_decisions_total ?? 0, dashboard_decisions_open: d.dashboard_decisions_open ?? 0, dashboard_decisions_closed: d.dashboard_decisions_closed ?? 0,
          reports_total: d.reports_total ?? 0, reports_open: d.reports_open ?? 0, reports_closed: d.reports_closed ?? 0,
        });
      }
    } catch (err) {
      console.error('[MinutesHub] count fetch exception', err);
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCounts();

    const handleFocus = () => fetchCounts();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchCounts();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchCounts]);

  const cards = visibleCards
    ? CARDS.filter(c => visibleCards.has(c.id))
    : CARDS;

  return (
    <div dir="rtl" className="space-y-6">
      <PageHeader
        title="صورت‌جلسات و مصوبات"
        description="مدیریت کامل صورت‌جلسات، مصوبات و پیگیری اقدامات"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
        {cards.map(card => {
          const Icon = card.icon;
          const primaryBadge = card.badgeKey ? formatBadge(counts[card.badgeKey]) : null;
          const secondaryBadge = card.secondaryBadgeKey ? formatBadge(counts[card.secondaryBadgeKey]) : null;
          const stats = getCardStats(counts, card);
          return (
            <button
              key={card.id}
              onClick={() => onNavigate(card.id)}
              className="group relative bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 sm:p-6 text-right transition-all hover:shadow-lg hover:border-gray-200 dark:hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-300 dark:focus:border-blue-600"
              aria-label={card.title}
            >
              {/* Primary badge */}
              {primaryBadge && (
                <span
                  className="absolute top-3 left-3 inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full text-xs font-bold text-white bg-red-500 shadow-sm"
                  aria-label={`${card.title}: ${primaryBadge} ${ARIA_LABELS[card.badgeKey!]}`}
                >
                  {primaryBadge}
                </span>
              )}
              {/* Secondary badge */}
              {secondaryBadge && (
                <span
                  className="absolute top-3 left-3 inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full text-xs font-bold text-white bg-blue-500 shadow-sm"
                  style={{ left: primaryBadge ? 'calc(1rem + 32px)' : '0.75rem' }}
                  aria-label={`${card.title}: ${secondaryBadge} ${ARIA_LABELS[card.secondaryBadgeKey!]}`}
                >
                  {secondaryBadge}
                </span>
              )}
              <div className={`w-12 h-12 rounded-xl ${card.bgColor} flex items-center justify-center mb-4 transition-transform group-hover:scale-105`}>
                <Icon className={`w-6 h-6 ${card.color}`} />
              </div>
              <h3 className="text-base font-bold text-gray-900 dark:text-white mb-1">
                {card.title}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
                {card.description}
              </p>

              {/* Per-card counters: کل موارد / باز / بسته */}
              <div className="flex items-center gap-3 mt-3">
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                ) : fetchError ? (
                  <span className="inline-flex items-center gap-1 text-xs text-red-500">
                    <AlertCircle className="w-3.5 h-3.5" />
                    خطا در دریافت آمار
                  </span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 dark:text-gray-300">
                      <span className="text-gray-400 dark:text-gray-500">کل موارد:</span>
                      <span className="font-bold text-gray-800 dark:text-white">{toPersianDigits(stats.total)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                      <span className="text-amber-400 dark:text-amber-500">باز:</span>
                      <span className="font-bold">{toPersianDigits(stats.open)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
                      <span className="text-green-400 dark:text-green-500">بسته:</span>
                      <span className="font-bold">{toPersianDigits(stats.closed)}</span>
                    </span>
                  </>
                )}
              </div>

              <div className={`mt-4 flex items-center gap-1 text-sm ${card.color} opacity-0 group-hover:opacity-100 transition-opacity`}>
                <span>ورود</span>
                <ChevronLeft className="w-4 h-4" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
