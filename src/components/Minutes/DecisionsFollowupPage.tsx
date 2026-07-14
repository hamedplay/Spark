import { useState } from 'react';
import { Search, ListFilter as Filter, Eye, TrendingUp, TriangleAlert as AlertTriangle, History, X } from 'lucide-react';
import {
  PageHeader, DecisionStatusBadge, DecisionPriorityBadge, ProgressIndicator, EmptyState,
} from './MinutesShared';
import { MOCK_DECISIONS } from './mockData';
import type { DecisionStatus, DecisionPriority } from './types';

interface Props {
  onNavigate: (page: string) => void;
}

export function DecisionsFollowupPage({ onNavigate }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DecisionStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<DecisionPriority | 'all'>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [withObstacles, setWithObstacles] = useState(false);
  const [unitFilter, setUnitFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [historyModal, setHistoryModal] = useState<string | null>(null);
  const [followupModal, setFollowupModal] = useState<string | null>(null);
  const [statusChangeModal, setStatusChangeModal] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const filtered = MOCK_DECISIONS.filter(d => {
    const matchSearch = !search || d.title.includes(search) || d.primaryOwner.includes(search);
    const matchStatus = statusFilter === 'all' || d.status === statusFilter;
    const matchPriority = priorityFilter === 'all' || d.priority === priorityFilter;
    const matchUnit = !unitFilter || (d.responsibleUnit || '').includes(unitFilter);
    const matchOwner = !ownerFilter || d.primaryOwner.includes(ownerFilter);
    const matchOverdue = !overdueOnly || (d.status !== 'completed' && d.status !== 'stopped');
    const matchObstacles = !withObstacles || d.notes !== undefined;
    return matchSearch && matchStatus && matchPriority && matchUnit && matchOwner && matchOverdue && matchObstacles;
  });

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader
        title="پیگیری مصوبات"
        description="نظارت و پیگیری وضعیت اجرای مصوبات"
        actions={
          <button
            onClick={() => setShowFilters(f => !f)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Filter className="w-4 h-4" />
            فیلترها
          </button>
        }
      />

      {/* Filters */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
              <option value="in_progress">در حال انجام</option>
              <option value="waiting_coordination">منتظر هماهنگی</option>
              <option value="completed">تکمیل‌شده</option>
              <option value="stopped">متوقف‌شده</option>
            </select>
            <select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value as DecisionPriority | 'all')}
              className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            >
              <option value="all">همه اولویت‌ها</option>
              <option value="urgent">فوری</option>
              <option value="important">مهم</option>
              <option value="normal">عادی</option>
              <option value="low">کم</option>
            </select>
            <input
              type="text"
              placeholder="واحد مسئول..."
              value={unitFilter}
              onChange={e => setUnitFilter(e.target.value)}
              className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            />
            <input
              type="text"
              placeholder="مسئول..."
              value={ownerFilter}
              onChange={e => setOwnerFilter(e.target.value)}
              className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={e => setOverdueOnly(e.target.checked)}
                className="w-4 h-4 rounded accent-red-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" /> فقط عقب‌افتاده‌ها
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={withObstacles}
                onChange={e => setWithObstacles(e.target.checked)}
                className="w-4 h-4 rounded accent-orange-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">دارای مانع</span>
            </label>
          </div>
        </div>
      )}

      {/* Search bar (always visible) */}
      {!showFilters && (
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="جستجو در مصوبات..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pr-9 pl-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:text-white"
          />
        </div>
      )}

      {/* Results count */}
      <p className="text-sm text-gray-500 dark:text-gray-400">{filtered.length} مصوبه</p>

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
                    {['عنوان','مسئول','واحد','وضعیت','اولویت','مهلت','پیشرفت','آخرین پیگیری','عملیات'].map(h => (
                      <th key={h} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {filtered.map(d => (
                    <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 dark:text-white">{d.title}</p>
                        {d.notes && (
                          <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5 flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3" /> {d.notes}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{d.primaryOwner}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{d.responsibleUnit || '—'}</td>
                      <td className="px-4 py-3"><DecisionStatusBadge status={d.status} /></td>
                      <td className="px-4 py-3"><DecisionPriorityBadge priority={d.priority} /></td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{d.deadline || '—'}</td>
                      <td className="px-4 py-3 w-36"><ProgressIndicator percent={d.progressPercent} /></td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">—</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => onNavigate('minutes-detail')} aria-label="مشاهده" title="مشاهده"
                            className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button onClick={() => setFollowupModal(d.id)} aria-label="ثبت پیگیری" title="ثبت پیگیری"
                            className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-500 transition-colors">
                            <TrendingUp className="w-4 h-4" />
                          </button>
                          <button onClick={() => setStatusChangeModal(d.id)} aria-label="تغییر وضعیت" title="تغییر وضعیت"
                            className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-500 transition-colors">
                            <Filter className="w-4 h-4" />
                          </button>
                          <button onClick={() => setHistoryModal(d.id)} aria-label="تاریخچه" title="تاریخچه"
                            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
                            <History className="w-4 h-4" />
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
                  <div className="flex flex-wrap gap-2 items-center">
                    <DecisionStatusBadge status={d.status} />
                    <span className="text-xs text-gray-500 dark:text-gray-400">{d.primaryOwner}</span>
                    {d.deadline && <span className="text-xs text-gray-500 dark:text-gray-400">مهلت: {d.deadline}</span>}
                  </div>
                  <ProgressIndicator percent={d.progressPercent} />
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setFollowupModal(d.id)} className="text-xs px-2.5 py-1.5 rounded-xl bg-green-50 text-green-600 hover:bg-green-100 transition-colors">ثبت پیگیری</button>
                    <button onClick={() => setStatusChangeModal(d.id)} className="text-xs px-2.5 py-1.5 rounded-xl bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors">تغییر وضعیت</button>
                    <button onClick={() => setHistoryModal(d.id)} className="text-xs px-2.5 py-1.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 transition-colors">تاریخچه</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Followup modal */}
      {followupModal && (
        <FollowupModal title="ثبت پیگیری" onClose={() => setFollowupModal(null)}>
          <div className="space-y-3">
            <div>
              <label htmlFor="followup-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ پیگیری</label>
              <input id="followup-date" type="text" placeholder="۱۴۰۳/۰۵/۲۰" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white" />
            </div>
            <div>
              <label htmlFor="followup-desc" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شرح پیگیری</label>
              <textarea id="followup-desc" rows={3} className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white resize-none" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setFollowupModal(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors">ثبت</button>
            <button onClick={() => setFollowupModal(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors">انصراف</button>
          </div>
        </FollowupModal>
      )}

      {/* Status change modal */}
      {statusChangeModal && (
        <FollowupModal title="تغییر وضعیت" onClose={() => setStatusChangeModal(null)}>
          <div className="space-y-3">
            <div>
              <label htmlFor="new-status" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">وضعیت جدید</label>
              <select id="new-status" className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white">
                <option value="not_started">شروع‌نشده</option>
                <option value="in_progress">در حال انجام</option>
                <option value="completed">تکمیل‌شده</option>
                <option value="stopped">متوقف‌شده</option>
              </select>
            </div>
            <div>
              <label htmlFor="status-note" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">توضیحات</label>
              <textarea id="status-note" rows={2} className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white resize-none" />
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setStatusChangeModal(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors">ذخیره</button>
            <button onClick={() => setStatusChangeModal(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors">انصراف</button>
          </div>
        </FollowupModal>
      )}

      {/* History modal */}
      {historyModal && (
        <FollowupModal title="تاریخچه پیگیری" onClose={() => setHistoryModal(null)}>
          <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
            <div className="p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl">
              <p className="font-medium text-gray-800 dark:text-gray-200">پیگیری اولیه</p>
              <p className="text-xs mt-1">۱۴۰۳/۰۵/۱۵ — بررسی اولیه انجام شد</p>
            </div>
            <p className="text-center text-gray-400 dark:text-gray-500 text-xs">داده‌های واقعی در مرحله بعدی بارگذاری می‌شود</p>
          </div>
        </FollowupModal>
      )}
    </div>
  );
}

function FollowupModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
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
