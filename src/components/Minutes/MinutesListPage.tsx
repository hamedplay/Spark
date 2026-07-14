import { useState } from 'react';
import { Plus, Search, X, Eye, CreditCard as Edit2, Send, Printer, Trash2, CircleCheck as CheckCircle2 } from 'lucide-react';
import {
  PageHeader, MinutesStatusBadge, ConfidentialityBadge,
  EmptyState, TableSkeleton, ConfirmActionDialog,
} from './MinutesShared';
import { MOCK_MINUTES } from './mockData';
import type { MinutesStatus, ConfidentialityLevel } from './types';

interface Props {
  onNavigate: (page: string) => void;
}

export function MinutesListPage({ onNavigate }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MinutesStatus | 'all'>('all');
  const [confidentialityFilter, setConfidentialityFilter] = useState<ConfidentialityLevel | 'all'>('all');
  const [orgUnitFilter, setOrgUnitFilter] = useState('');
  const [isLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const filtered = MOCK_MINUTES.filter(m => {
    const matchSearch = !search || m.meetingTitle.includes(search) || m.secretary.includes(search) || m.chair.includes(search);
    const matchStatus = statusFilter === 'all' || m.status === statusFilter;
    const matchConf = confidentialityFilter === 'all' || m.confidentiality === confidentialityFilter;
    const matchUnit = !orgUnitFilter || (m.orgUnit || '').includes(orgUnitFilter);
    return matchSearch && matchStatus && matchConf && matchUnit;
  });

  const hasFilters = search || statusFilter !== 'all' || confidentialityFilter !== 'all' || orgUnitFilter;

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setConfidentialityFilter('all');
    setOrgUnitFilter('');
  };

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader
        title="صورت‌جلسات"
        description="مدیریت و پیگیری صورت‌جلسات سازمانی"
        actions={
          <button
            onClick={() => onNavigate('minutes-new')}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            ایجاد صورت‌جلسه
          </button>
        }
      />

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {/* Search */}
          <div className="relative sm:col-span-2">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="جستجو در عنوان، دبیر یا رئیس جلسه..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pr-9 pl-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Status */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as MinutesStatus | 'all')}
            className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          >
            <option value="all">همه وضعیت‌ها</option>
            <option value="draft">پیش‌نویس</option>
            <option value="pending_approval">در انتظار تأیید</option>
            <option value="approved">تأییدشده</option>
            <option value="rejected">ردشده</option>
            <option value="published">منتشرشده</option>
          </select>

          {/* Confidentiality */}
          <select
            value={confidentialityFilter}
            onChange={e => setConfidentialityFilter(e.target.value as ConfidentialityLevel | 'all')}
            className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          >
            <option value="all">همه سطوح</option>
            <option value="public">عمومی</option>
            <option value="organizational">سازمانی</option>
            <option value="restricted">محدود</option>
            <option value="confidential">محرمانه</option>
          </select>

          {/* Org Unit */}
          <input
            type="text"
            placeholder="واحد سازمانی..."
            value={orgUnitFilter}
            onChange={e => setOrgUnitFilter(e.target.value)}
            className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          />
        </div>

        {hasFilters && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">{filtered.length} نتیجه</span>
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600 transition-colors"
            >
              <X className="w-3 h-3" />
              پاک‌کردن فیلترها
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={5} />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search className="w-8 h-8" />}
            title="صورت‌جلسه‌ای یافت نشد"
            description="فیلترها را تغییر دهید یا صورت‌جلسه جدید ایجاد کنید."
            action={
              <button
                onClick={() => onNavigate('minutes-new')}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" /> ایجاد صورت‌جلسه
              </button>
            }
          />
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                    {['عنوان جلسه','تاریخ','دبیر','رئیس جلسه','وضعیت','محرمانگی','مصوبات','آخرین ویرایش','عملیات'].map(h => (
                      <th key={h} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {filtered.map(m => (
                    <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => onNavigate('minutes-detail')}
                          className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline text-right"
                        >
                          {m.meetingTitle}
                        </button>
                        {m.orgUnit && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{m.orgUnit}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{m.meetingDate}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{m.secretary}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{m.chair}</td>
                      <td className="px-4 py-3"><MinutesStatusBadge status={m.status} /></td>
                      <td className="px-4 py-3"><ConfidentialityBadge level={m.confidentiality} /></td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-semibold">
                          {m.decisionCount}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">{m.lastModified}</td>
                      <td className="px-4 py-3">
                        <RowActions
                          status={m.status}
                          onView={() => onNavigate('minutes-detail')}
                          onEdit={() => onNavigate('minutes-edit')}
                          onSendApproval={() => {}}
                          onPrint={() => {}}
                          onDelete={() => setDeleteTarget(m.id)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(m => (
                <div key={m.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() => onNavigate('minutes-detail')}
                      className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline text-right leading-snug"
                    >
                      {m.meetingTitle}
                    </button>
                    <MinutesStatusBadge status={m.status} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                    <span>{m.meetingDate}</span>
                    <span>دبیر: {m.secretary}</span>
                    <span>رئیس: {m.chair}</span>
                    <span>{m.decisionCount} مصوبه</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <ConfidentialityBadge level={m.confidentiality} />
                    <RowActions
                      status={m.status}
                      onView={() => onNavigate('minutes-detail')}
                      onEdit={() => onNavigate('minutes-edit')}
                      onSendApproval={() => {}}
                      onPrint={() => {}}
                      onDelete={() => setDeleteTarget(m.id)}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination placeholder */}
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>نمایش {filtered.length} از {MOCK_MINUTES.length}</span>
              <div className="flex items-center gap-1">
                <button className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">قبلی</button>
                <span className="px-2.5 py-1 rounded-lg bg-blue-600 text-white">۱</span>
                <button className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">بعدی</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmActionDialog
          title="حذف صورت‌جلسه"
          message="آیا مطمئن هستید که می‌خواهید این صورت‌جلسه را حذف کنید؟ این عملیات قابل بازگشت نیست."
          confirmLabel="حذف"
          onConfirm={() => setDeleteTarget(null)}
          onCancel={() => setDeleteTarget(null)}
          danger
        />
      )}
    </div>
  );
}

// ── RowActions ──────────────────────────────────────────────────────────────

interface RowActionsProps {
  status: MinutesStatus;
  onView: () => void;
  onEdit: () => void;
  onSendApproval: () => void;
  onPrint: () => void;
  onDelete: () => void;
}

function RowActions({ status, onView, onEdit, onSendApproval, onPrint, onDelete }: RowActionsProps) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <button onClick={onView} aria-label="مشاهده" title="مشاهده"
        className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors">
        <Eye className="w-4 h-4" />
      </button>
      {(status === 'draft' || status === 'rejected') && (
        <button onClick={onEdit} aria-label="ویرایش" title="ویرایش"
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
          <Edit2 className="w-4 h-4" />
        </button>
      )}
      {status === 'draft' && (
        <button onClick={onSendApproval} aria-label="ارسال برای تأیید" title="ارسال برای تأیید"
          className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-500 transition-colors">
          <Send className="w-4 h-4" />
        </button>
      )}
      {status === 'approved' && (
        <button onClick={() => {}} aria-label="انتشار" title="انتشار"
          className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-500 transition-colors">
          <CheckCircle2 className="w-4 h-4" />
        </button>
      )}
      <button onClick={onPrint} aria-label="چاپ" title="چاپ"
        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
        <Printer className="w-4 h-4" />
      </button>
      {status === 'draft' && (
        <button onClick={onDelete} aria-label="حذف" title="حذف"
          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
