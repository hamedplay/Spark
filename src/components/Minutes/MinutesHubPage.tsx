import { useState, useEffect, useCallback } from 'react';
import {
  LayoutDashboard,
  FileText,
  ClipboardList,
  SquareCheck as DecisionIcon,
  TrendingUp,
  ChartBar as BarChart2,
  ChevronLeft,
} from 'lucide-react';
import { PageHeader } from './MinutesShared';
import { supabase } from '../../lib/supabase';
import type { PageId } from '../../app/navigation/useNavigation';

interface HubCard {
  id: PageId;
  title: string;
  description: string;
  icon: typeof LayoutDashboard;
  color: string;
  bgColor: string;
  /** Which counter field maps to the primary badge. */
  badgeKey?: BadgeKey;
  /** Optional secondary badge field. */
  secondaryBadgeKey?: BadgeKey;
}

type BadgeKey = 'minutes_unread' | 'approvals_pending' | 'my_decisions_unread' | 'my_decisions_active' | 'followup_actionable';

interface HubCounts {
  minutes_unread: number;
  approvals_pending: number;
  my_decisions_unread: number;
  my_decisions_active: number;
  followup_actionable: number;
}

const CARDS: HubCard[] = [
  {
    id: 'minutes-dashboard',
    title: 'داشبورد',
    description: 'خلاصه وضعیت صورت‌جلسات و مصوبات',
    icon: LayoutDashboard,
    color: 'text-blue-600 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
  },
  {
    id: 'minutes',
    title: 'صورت‌جلسات',
    description: 'فهرست تمام صورت‌جلسات',
    icon: FileText,
    color: 'text-indigo-600 dark:text-indigo-400',
    bgColor: 'bg-indigo-50 dark:bg-indigo-900/20',
    badgeKey: 'minutes_unread',
  },
  {
    id: 'minutes-approvals',
    title: 'کارتابل تأیید',
    description: 'صورت‌جلسات در انتظار تأیید شما',
    icon: ClipboardList,
    color: 'text-amber-600 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-900/20',
    badgeKey: 'approvals_pending',
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
  },
  {
    id: 'minutes-followup',
    title: 'پیگیری مصوبات',
    description: 'پایش پیشرفت و سررسید مصوبات',
    icon: TrendingUp,
    color: 'text-rose-600 dark:text-rose-400',
    bgColor: 'bg-rose-50 dark:bg-rose-900/20',
    badgeKey: 'followup_actionable',
  },
  {
    id: 'minutes-reports',
    title: 'گزارش‌ها',
    description: 'گزارش‌های تحلیلی و خروجی',
    icon: BarChart2,
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
  },
];

const EMPTY_COUNTS: HubCounts = {
  minutes_unread: 0,
  approvals_pending: 0,
  my_decisions_unread: 0,
  my_decisions_active: 0,
  followup_actionable: 0,
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

interface Props {
  onNavigate: (page: PageId) => void;
  visibleCards?: Set<PageId>;
}

export function MinutesHubPage({ onNavigate, visibleCards }: Props) {
  const [counts, setCounts] = useState<HubCounts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);

  const fetchCounts = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc('get_my_minutes_hub_counts');
      if (error) {
        console.error('[MinutesHub] count fetch failed', { code: error.code, message: error.message });
        return;
      }
      if (data) {
        setCounts({
          minutes_unread: (data.minutes_unread as number) ?? 0,
          approvals_pending: (data.approvals_pending as number) ?? 0,
          my_decisions_unread: (data.my_decisions_unread as number) ?? 0,
          my_decisions_active: (data.my_decisions_active as number) ?? 0,
          followup_actionable: (data.followup_actionable as number) ?? 0,
        });
      }
    } catch (err) {
      console.error('[MinutesHub] count fetch exception', err);
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
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                {card.description}
              </p>
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
