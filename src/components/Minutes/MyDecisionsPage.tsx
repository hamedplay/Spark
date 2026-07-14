import { useState } from 'react';
import { Search, X, Eye, TrendingUp, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, ChartBar as BarChart2 } from 'lucide-react';
import {
  PageHeader, StatCard, DecisionStatusBadge, DecisionPriorityBadge, ProgressIndicator, EmptyState,
} from './MinutesShared';
import { MOCK_DECISIONS } from './mockData';
import type { DecisionStatus, DecisionPriority } from './types';

interface Props {
  onNavigate: (page: string) => void;
}

export function MyDecisionsPage({ onNavigate }: Props) {
  const [statusFilter, setStatusFilter] = useState<DecisionStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<DecisionPriority | 'all'>('all');
  const [search, setSearch] = useState('');
  const [progressModal, setProgressModal] = useState<string | null>(null);
  const [obstacleModal, setObstacleModal] = useState<string | null>(null);

  const filtered = MOCK_DECISIONS.filter(d => {
    const matchSearch = !search || d.title.includes(search) || d.primaryOwner.includes(search);
    const matchStatus = statusFilter === 'all' || d.status === statusFilter;
    const matchPriority = priorityFilter === 'all' || d.priority === priorityFilter;
    return matchSearch && matchStatus && matchPriority;
  });

  const stats = {
    total: MOCK_DECISIONS.length,
    inProgress: MOCK_DECISIONS.filter(d => d.status === 'in_progress').length,
    overdue: MOCK_DECISIONS.filter(d => d.status !== 'completed' && d.status !== 'stopped').length,
    completed: MOCK_DECISIONS.filter(d => d.status === 'completed').length,
    stopped: MOCK_DECISIONS.filter(d => d.status === 'stopped').length,
  };

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader title="مصوبات من" description="مصوباتی که به‌عنوان مسئول اصلی به شما واگذار شده است" />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="کل مصوبات"    value={stats.total}      icon={<BarChart2 className="w-5 h-5 text-gray-500" />}   colorClass="bg-gray-100 dark:bg-gray-700" />
        <StatCard label="در حال انجام" value={stats.inProgress} icon={<TrendingUp className="w-5 h-5 text-blue-500" />}  colorClass="bg-blue-50 dark:bg-blue-900/20" />
        <StatCard label="عقب‌افتاده"   value={stats.overdue}   icon={<AlertTriangle className="w-5 h-5 text-red-500" />} colorClass="bg-red-50 dark:bg-red-900/20" />
        <StatCard label="تکمیل‌شده"    value={stats.completed} icon={<CheckCircle className="w-5 h-5 text-green-500" />} colorClass="bg-green-50 dark:bg-green-900/20" />
        <StatCard label="متوقف‌شده"    value={stats.stopped}   icon={<X className="w-5 h-5 text-orange-500" />}          colorClass="bg-orange-50 dark:bg-orange-900/20" />
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="جستجو..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pr-9 pl-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as DecisionStatus | 'all')}
            className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          >
            <option value="all">همه وضعیت‌ها</option>
            <option value="not_started">شروع‌نشده</option>
            <option value="planned">برنامه‌ریزی‌شده</option>
            <option value="in_progress">در حال انجام</option>
            <option value="waiting_coordination">منتظر هماهنگی</option>
            <option value="waiting_approval">منتظر تأیید</option>
            <option value="completed">تکمیل‌شده</option>
            <option value="stopped">متوقف‌شده</option>
          </select>
          <select
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value as DecisionPriority | 'all')}
            className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          >
            <option value="all">همه اولویت‌ها</option>
            <option value="low">کم</option>
            <option value="normal">عادی</option>
            <option value="important">مهم</option>
            <option value="urgent">فوری</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={<Search className="w-8 h-8" />} title="مصوبه‌ای یافت نشد" description="فیلترها را تغییر دهید." />
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    {['عنوان مصوبه','مسئول','اولویت','وضعیت','پیشرفت','مهلت','عملیات'].map(h => (
                      <th key={h} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {filtered.map(d => (
                    <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 dark:text-white">{d.title}</p>
                        {d.responsibleUnit && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{d.responsibleUnit}</p>}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{d.primaryOwner}</td>
                      <td className="px-4 py-3"><DecisionPriorityBadge priority={d.priority} /></td>
                      <td className="px-4 py-3"><DecisionStatusBadge status={d.status} /></td>
                      <td className="px-4 py-3 w-40"><ProgressIndicator percent={d.progressPercent} /></td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">{d.deadline || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onNavigate('minutes-detail')}
                            aria-label="مشاهده"
                            title="مشاهده"
                            className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setProgressModal(d.id)}
                            className="text-xs px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition-colors whitespace-nowrap"
                          >
                            ثبت پیشرفت
                          </button>
                          <button
                            onClick={() => setObstacleModal(d.id)}
                            className="text-xs px-2 py-1 rounded-lg bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 hover:bg-orange-100 transition-colors whitespace-nowrap"
                          >
                            ثبت مانع
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(d => (
                <div key={d.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">{d.title}</p>
                    <DecisionPriorityBadge priority={d.priority} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <DecisionStatusBadge status={d.status} />
                    {d.deadline && <span className="text-xs text-gray-500 dark:text-gray-400">مهلت: {d.deadline}</span>}
                  </div>
                  <ProgressIndicator percent={d.progressPercent} />
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setProgressModal(d.id)} className="text-xs px-2.5 py-1.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
                      ثبت پیشرفت
                    </button>
                    <button onClick={() => setObstacleModal(d.id)} className="text-xs px-2.5 py-1.5 rounded-xl bg-orange-50 text-orange-600 hover:bg-orange-100 transition-colors">
                      ثبت مانع
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
              نمایش {filtered.length} از {MOCK_DECISIONS.length}
            </div>
          </>
        )}
      </div>

      {/* Progress modal */}
      {progressModal && (
        <SimpleModal title="ثبت پیشرفت" onClose={() => setProgressModal(null)}>
          <div className="space-y-3">
            <div>
              <label htmlFor="progress-value" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">درصد پیشرفت جدید</label>
              <input id="progress-value" type="range" min={0} max={100} step={5} defaultValue={50} className="w-full accent-blue-600" />
            </div>
            <div>
              <label htmlFor="progress-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">توضیحات</label>
              <textarea id="progress-note" rows={3} className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white resize-none" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setProgressModal(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors">ثبت</button>
            <button onClick={() => setProgressModal(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors">انصراف</button>
          </div>
        </SimpleModal>
      )}

      {/* Obstacle modal */}
      {obstacleModal && (
        <SimpleModal title="ثبت مانع" onClose={() => setObstacleModal(null)}>
          <div className="space-y-3">
            <div>
              <label htmlFor="obstacle-title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">عنوان مانع</label>
              <input id="obstacle-title" type="text" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white" />
            </div>
            <div>
              <label htmlFor="obstacle-desc" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شرح مانع</label>
              <textarea id="obstacle-desc" rows={3} className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white resize-none" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setObstacleModal(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-orange-500 hover:bg-orange-600 text-white transition-colors">ثبت مانع</button>
            <button onClick={() => setObstacleModal(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors">انصراف</button>
          </div>
        </SimpleModal>
      )}
    </div>
  );
}

function SimpleModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="font-bold text-gray-900 dark:text-white">{title}</h3>
          <button onClick={onClose} aria-label="بستن" className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
