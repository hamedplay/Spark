import { FileText, Clock, CircleCheck as CheckCircle, CircleAlert as AlertCircle, TrendingUp, Plus, ArrowLeft, ChevronLeft } from 'lucide-react';
import {
  PageHeader, StatCard, MinutesStatusBadge, DecisionStatusBadge,
  DecisionPriorityBadge, ProgressIndicator,
} from './MinutesShared';
import {
  MOCK_DASHBOARD_STATS, MOCK_MINUTES, MOCK_DECISIONS,
} from './mockData';

interface Props {
  onNavigate: (page: string) => void;
}

export function MinutesDashboardPage({ onNavigate }: Props) {

  const recentMinutes = MOCK_MINUTES.slice(0, 4);
  const actionDecisions = MOCK_DECISIONS.filter(d =>
    d.status === 'in_progress' || d.status === 'waiting_coordination'
  ).slice(0, 5);
  const overdueDecisions = MOCK_DECISIONS.filter(d => d.status !== 'completed' && d.status !== 'stopped').slice(0, 3);

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

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard
          label="پیش‌نویس"
          value={MOCK_DASHBOARD_STATS.draftMinutes}
          icon={<FileText className="w-6 h-6 text-gray-500" />}
          colorClass="bg-gray-100 dark:bg-gray-700"
          onClick={() => onNavigate('minutes')}
        />
        <StatCard
          label="منتظر تأیید من"
          value={MOCK_DASHBOARD_STATS.pendingMyApproval}
          icon={<Clock className="w-6 h-6 text-amber-500" />}
          colorClass="bg-amber-50 dark:bg-amber-900/20"
          onClick={() => onNavigate('minutes-approvals')}
        />
        <StatCard
          label="مصوبات فعال"
          value={MOCK_DASHBOARD_STATS.activeDecisions}
          icon={<TrendingUp className="w-6 h-6 text-blue-500" />}
          colorClass="bg-blue-50 dark:bg-blue-900/20"
          onClick={() => onNavigate('minutes-my-decisions')}
        />
        <StatCard
          label="عقب‌افتاده"
          value={MOCK_DASHBOARD_STATS.overdueDecisions}
          icon={<AlertCircle className="w-6 h-6 text-red-500" />}
          colorClass="bg-red-50 dark:bg-red-900/20"
          onClick={() => onNavigate('minutes-followup')}
        />
        <StatCard
          label="نزدیک سررسید"
          value={MOCK_DASHBOARD_STATS.nearDeadlineDecisions}
          icon={<Clock className="w-6 h-6 text-orange-500" />}
          colorClass="bg-orange-50 dark:bg-orange-900/20"
        />
        <StatCard
          label="تکمیل‌شده"
          value={MOCK_DASHBOARD_STATS.completedDecisions}
          icon={<CheckCircle className="w-6 h-6 text-green-500" />}
          colorClass="bg-green-50 dark:bg-green-900/20"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Recent Minutes */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-900 dark:text-white">آخرین صورت‌جلسات</h2>
            <button
              onClick={() => onNavigate('minutes')}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              همه <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            {recentMinutes.map(m => (
              <div
                key={m.id}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                onClick={() => onNavigate('minutes-detail')}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{m.meetingTitle}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{m.meetingDate} · {m.secretary}</p>
                </div>
                <MinutesStatusBadge status={m.status} />
              </div>
            ))}
          </div>
        </div>

        {/* Action Decisions */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-900 dark:text-white">مصوبات نیازمند اقدام</h2>
            <button
              onClick={() => onNavigate('minutes-my-decisions')}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              همه <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            {actionDecisions.map(d => (
              <div key={d.id} className="p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-medium text-gray-900 dark:text-white leading-snug">{d.title}</p>
                  <DecisionPriorityBadge priority={d.priority} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <DecisionStatusBadge status={d.status} />
                  <ProgressIndicator percent={d.progressPercent} />
                </div>
                {d.deadline && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">مهلت: {d.deadline}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Overdue Decisions */}
      {overdueDecisions.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-red-100 dark:border-red-900/30 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-500" />
              <h2 className="font-bold text-gray-900 dark:text-white">مصوبات عقب‌افتاده</h2>
            </div>
            <button
              onClick={() => onNavigate('minutes-followup')}
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
            >
              پیگیری <ArrowLeft className="w-4 h-4" />
            </button>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {overdueDecisions.map(d => (
              <div key={d.id} className="py-3 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{d.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{d.primaryOwner} · {d.responsibleUnit}</p>
                </div>
                <DecisionPriorityBadge priority={d.priority} />
                {d.deadline && (
                  <span className="text-xs text-red-600 dark:text-red-400 font-medium whitespace-nowrap">
                    مهلت: {d.deadline}
                  </span>
                )}
                <ProgressIndicator percent={d.progressPercent} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
