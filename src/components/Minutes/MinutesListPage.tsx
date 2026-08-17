import { useEffect, useState, useCallback } from 'react';
import { Plus, Search, X, Eye, CreditCard as Edit2, Send, Printer, Trash2, CircleAlert as AlertCircle, Loader as Loader2, ChevronDown, SlidersHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, MinutesStatusBadge, ConfidentialityBadge,
  EmptyState, TableSkeleton, ConfirmActionDialog,
} from './MinutesShared';
import { MinutesBackButton } from './MinutesBackButton';
import { supabase } from '../../lib/supabase';
import {
  setMinuteIdInUrl,
} from '../../lib/minutesNavigation';
import { formatJalaliDateForDisplay, formatJalaliTimestampDateOnly } from '../../lib/minutesDate';
import type { MinutesStatus, ConfidentialityLevel, MinuteSummary, ApprovalMode } from './types';

interface Props {
  onNavigate: (page: string) => void;
}

export function MinutesListPage({ onNavigate }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<MinutesStatus | 'all'>('all');
  const [confidentialityFilter, setConfidentialityFilter] = useState<ConfidentialityLevel | 'all'>('all');
  const [orgUnitFilter, setOrgUnitFilter] = useState('');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<MinuteSummary[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [sendingId, setSendingId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);

  const handleSendForApproval = async (id: string) => {
    const target = minutes.find(m => m.id === id);
    if (!target) return;
    if (!target.approvalMode) {
      toast('این صورت‌جلسه هنوز مدل تأیید ندارد. لطفاً از صفحه ویرایش، مدل تأیید را تنظیم و سپس ارسال کنید.', { icon: '⚠️' });
      setMinuteIdInUrl(id);
      onNavigate('minutes-edit');
      return;
    }
    setSendingId(id);
    try {
      const { data, error: rpcError } = await supabase.rpc('submit_minutes_for_approval', {
        p_minute_id: id,
        p_expected_updated_at: target.updatedAt || null,
        p_approval_mode: target.approvalMode,
      });
      if (rpcError) { toast.error('ارسال صورت‌جلسه ناموفق بود: ' + rpcError.message); return; }
      if (data && data.success === false) {
        const code: string = data.error_code || 'INTERNAL_ERROR';
        const msgs: Record<string, string> = {
          MINUTE_NOT_SUBMITTABLE: 'این صورت‌جلسه در وضعیت قابل ارسال نیست.',
          APPROVAL_MODE_IMMUTABLE: 'مدل تأیید تغییر نمی‌کند.',
          MINUTES_VERSION_CONFLICT: 'این صورت‌جلسه توسط کاربر دیگری تغییر کرده است. صفحه را دوباره بارگذاری کنید.',
          NO_ELIGIBLE_APPROVERS: 'هیچ شرکت‌کننده واجد شرایطی برای تأیید سیستمی وجود ندارد.',
        };
        toast.error(msgs[code] || 'ارسال ناموفق بود.');
        return;
      }
      if (data?.success === true) { toast.success('صورت‌جلسه برای تأیید ارسال شد.'); await fetchMinutes(); }
    } catch { toast.error('خطای غیرمنتظره هنگام ارسال.'); } finally { setSendingId(null); }
  };

  const handlePrint = async (id: string) => {
    setPrintingId(id);
    setMinuteIdInUrl(id);
    const url = new URL(window.location.href);
    url.searchParams.set('print', '1');
    window.history.replaceState(null, '', url.toString());
    onNavigate('minutes-detail');
    setPrintingId(null);
  };

  const fetchMinutes = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const { data, error: fetchError } = await supabase
      .from('minutes')
      .select('id, meeting_title_snapshot, meeting_date_snapshot, secretary_name_snapshot, chair_name_snapshot, status, confidentiality, org_unit_name_snapshot, updated_at, approval_mode, revision_number')
      .order('created_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setMinutes([]);
    } else {
      const rawRows = data || [];
      const ids = rawRows.map((row: Record<string, unknown>) => row.id as string).filter(Boolean);

      // Fetch decision counts via SECURITY DEFINER RPC to get accurate counts
      // regardless of RLS on minutes_decisions.
      let countMap: Record<string, number> = {};
      let countError = false;
      if (ids.length > 0) {
        try {
          const { data: countData, error: countErr } = await supabase.rpc('get_minutes_decision_counts', {
            p_minute_ids: ids,
          });
          if (countErr) throw countErr;
          for (const row of (countData || []) as Array<{ minute_id: string; decision_count: number }>) {
            countMap[row.minute_id] = Number(row.decision_count);
          }
        } catch (err) {
          if (import.meta.env.DEV) console.error('MinutesListPage: failed to fetch decision counts', err);
          countError = true;
        }
      }

      setMinutes(rawRows.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        meetingTitle: (row.meeting_title_snapshot as string) || '',
        meetingDate: formatJalaliDateForDisplay(row.meeting_date_snapshot as string),
        secretary: (row.secretary_name_snapshot as string) || '',
        chair: (row.chair_name_snapshot as string) || '',
        status: row.status as MinutesStatus,
        confidentiality: row.confidentiality as ConfidentialityLevel,
        decisionCount: countError ? null : (countMap[row.id as string] ?? 0),
        lastModified: formatJalaliTimestampDateOnly(row.updated_at as string),
        version: '',
        orgUnit: (row.org_unit_name_snapshot as string) || undefined,
        approvalMode: (row.approval_mode as ApprovalMode) || null,
        revisionNumber: (row.revision_number as number) || undefined,
        updatedAt: (row.updated_at as string) || undefined,
      })));
    }
    setIsLoading(false);
  }, []);

  useEffect(() => { fetchMinutes(); }, [fetchMinutes]);

  const filtered = minutes.filter(m => {
    const matchSearch = !search || m.meetingTitle.includes(search) || m.secretary.includes(search) || m.chair.includes(search);
    const matchStatus = statusFilter === 'all' || m.status === statusFilter;
    const matchConf = confidentialityFilter === 'all' || m.confidentiality === confidentialityFilter;
    const matchUnit = !orgUnitFilter || (m.orgUnit || '').includes(orgUnitFilter);
    return matchSearch && matchStatus && matchConf && matchUnit;
  });

  const hasFilters = Boolean(search || statusFilter !== 'all' || confidentialityFilter !== 'all' || orgUnitFilter);
  const activeFilterCount = [search, statusFilter !== 'all' ? statusFilter : '', confidentialityFilter !== 'all' ? confidentialityFilter : '', orgUnitFilter].filter(Boolean).length;

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setConfidentialityFilter('all');
    setOrgUnitFilter('');
  };

  const goToDetail = (id: string) => {
    setMinuteIdInUrl(id);
    onNavigate('minutes-detail');
  };

  const goToEdit = (id: string) => {
    setMinuteIdInUrl(id);
    onNavigate('minutes-edit');
  };

  const handleDelete = async () => {
    if (!deleteTarget || deletingId) return;
    setDeletingId(deleteTarget);
    try {
      const { error: delError } = await supabase
        .from('minutes')
        .delete()
        .eq('id', deleteTarget);
      if (delError) {
        toast.error('حذف صورت‌جلسه ناموفق بود. لطفاً دوباره تلاش کنید.');
        return;
      }
      toast.success('صورت‌جلسه حذف شد.');
      setDeleteTarget(null);
      await fetchMinutes();
    } catch {
      toast.error('خطای غیرمنتظره هنگام حذف.');
    } finally {
      setDeletingId(null);
    }
  };

  const closeDeleteDialog = () => {
    if (deletingId) return; // prevent closing while deleting
    setDeleteTarget(null);
  };

  return (
    <div dir="rtl" className="space-y-4 sm:space-y-5">
      <PageHeader
        title="صورت‌جلسات"
        description="مدیریت و پیگیری صورت‌جلسات سازمانی"
        actions={
          <div className="mobile-scroll-actions max-w-full sm:overflow-visible">
            <MinutesBackButton
              label="بازگشت به صورت‌جلسات و مصوبات"
              onClick={() => { onNavigate('minutes-hub'); }}
            />
            <button
              onClick={() => onNavigate('calendar')}
              className="flex flex-shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:px-4"
            >
              <Plus className="h-4 w-4" />
              انتخاب جلسه
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-4">
        <div className="flex items-center gap-2 sm:hidden">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(v => !v)}
            aria-expanded={mobileFiltersOpen}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 text-sm font-semibold text-gray-700 dark:bg-gray-700/70 dark:text-gray-200"
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-blue-500" />
              فیلتر و جست‌وجو
              {activeFilterCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                  {activeFilterCount.toLocaleString('fa-IR')}
                </span>
              )}
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform ${mobileFiltersOpen ? 'rotate-180' : ''}`} />
          </button>
          <span className="flex-shrink-0 text-[11px] text-gray-400">{filtered.length.toLocaleString('fa-IR')} مورد</span>
        </div>

        <div className={`${mobileFiltersOpen ? 'mt-3 block' : 'hidden'} sm:mt-0 sm:block`}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
            {/* Search */}
            <div className="relative col-span-2">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="عنوان، دبیر یا رئیس جلسه..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full rounded-xl border border-gray-200 py-2.5 pl-3 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              />
            </div>

            {/* Status */}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as MinutesStatus | 'all')}
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
              className="rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
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
              className="col-span-2 rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white sm:col-span-1"
            />
          </div>

          {hasFilters && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500 dark:text-gray-400">{filtered.length.toLocaleString('fa-IR')} نتیجه</span>
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-red-500 transition-colors hover:text-red-600"
              >
                <X className="h-3 w-3" />
                پاک‌کردن
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        {isLoading ? (
          <div className="p-4">
            <TableSkeleton rows={5} />
          </div>
        ) : error ? (
          <EmptyState
            icon={<AlertCircle className="w-8 h-8" />}
            title="خطا در بارگذاری صورت‌جلسات"
            description={error}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search className="w-8 h-8" />}
            title="صورت‌جلسه‌ای یافت نشد"
            description="فیلترها را تغییر دهید یا صورت‌جلسه جدید ایجاد کنید."
            action={
              <button
                onClick={() => onNavigate('calendar')}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                <Plus className="h-4 w-4" /> انتخاب جلسه از تقویم
              </button>
            }
          />
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/50">
                    {['عنوان جلسه','تاریخ','دبیر','رئیس جلسه','وضعیت','محرمانگی','مصوبات','آخرین ویرایش','عملیات'].map(h => (
                      <th key={h} className="whitespace-nowrap px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {filtered.map(m => (
                    <tr key={m.id} className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => goToDetail(m.id)}
                          className="text-right text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {m.meetingTitle}
                        </button>
                        {m.orgUnit && (
                          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{m.orgUnit}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-300">{m.meetingDate}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-300">{m.secretary}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700 dark:text-gray-300">{m.chair}</td>
                      <td className="px-4 py-3"><MinutesStatusBadge status={m.status} /></td>
                      <td className="px-4 py-3"><ConfidentialityBadge level={m.confidentiality} /></td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                          {m.decisionCount == null ? '—' : m.decisionCount}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{m.lastModified}</td>
                      <td className="px-4 py-3">
                        <RowActions
                          id={m.id}
                          status={m.status}
                          approvalMode={m.approvalMode}
                          onView={() => goToDetail(m.id)}
                          onEdit={() => goToEdit(m.id)}
                          onDelete={() => setDeleteTarget(m.id)}
                          onSendForApproval={() => handleSendForApproval(m.id)}
                          onPrint={() => handlePrint(m.id)}
                          sendingId={sendingId}
                          printingId={printingId}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="divide-y divide-gray-100 dark:divide-gray-700 lg:hidden">
              {filtered.map(m => (
                <article key={m.id} className="space-y-2.5 p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      onClick={() => goToDetail(m.id)}
                      className="mobile-line-clamp-2 min-w-0 flex-1 text-right text-sm font-semibold leading-6 text-blue-600 dark:text-blue-400"
                    >
                      {m.meetingTitle}
                    </button>
                    <MinutesStatusBadge status={m.status} />
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
                    <span>{m.meetingDate}</span>
                    <span className="truncate">{m.orgUnit || 'بدون واحد'}</span>
                    <span className="truncate">دبیر: {m.secretary}</span>
                    <span>{m.decisionCount == null ? '—' : m.decisionCount.toLocaleString('fa-IR')} مصوبه</span>
                  </div>
                  <div className="flex items-center gap-2 border-t border-gray-50 pt-2 dark:border-gray-700">
                    <ConfidentialityBadge level={m.confidentiality} />
                    <div className="min-w-0 flex-1">
                      <RowActions
                        id={m.id}
                        status={m.status}
                        approvalMode={m.approvalMode}
                        onView={() => goToDetail(m.id)}
                        onEdit={() => goToEdit(m.id)}
                        onDelete={() => setDeleteTarget(m.id)}
                        onSendForApproval={() => handleSendForApproval(m.id)}
                        onPrint={() => handlePrint(m.id)}
                        sendingId={sendingId}
                        printingId={printingId}
                      />
                    </div>
                  </div>
                </article>
              ))}
            </div>

            {/* Pagination placeholder */}
            <div className="flex items-center justify-between border-t border-gray-100 px-3 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400 sm:px-4">
              <span>{filtered.length.toLocaleString('fa-IR')} از {minutes.length.toLocaleString('fa-IR')}</span>
              <div className="flex items-center gap-1">
                <button className="rounded-lg bg-gray-100 px-2.5 py-1 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">قبلی</button>
                <span className="rounded-lg bg-blue-600 px-2.5 py-1 text-white">۱</span>
                <button className="rounded-lg bg-gray-100 px-2.5 py-1 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600">بعدی</button>
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
          confirmLabel={deletingId ? 'در حال حذف...' : 'حذف'}
          onConfirm={handleDelete}
          onCancel={closeDeleteDialog}
          danger
        />
      )}

      {/* Hidden: keep Loader2 import used for future inline spinner if needed */}
      <span className="hidden"><Loader2 className="w-0 h-0" /></span>
    </div>
  );
}

// ── RowActions ──────────────────────────────────────────────────────────────
interface RowActionsProps {
  id: string;
  status: MinutesStatus;
  approvalMode?: ApprovalMode | null;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSendForApproval: () => void;
  onPrint: () => void;
  sendingId: string | null;
  printingId: string | null;
}

function RowActions({ id, status, approvalMode, onView, onEdit, onDelete, onSendForApproval, onPrint, sendingId, printingId }: RowActionsProps) {
  const disabledCls = 'inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-gray-300 dark:text-gray-600 cursor-not-allowed lg:h-auto lg:w-auto lg:p-1.5';
  const enabledCls = 'inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg transition-colors lg:h-auto lg:w-auto lg:p-1.5';
  const canSend = (status === 'draft' || status === 'changes_requested') && !!approvalMode;
  return (
    <div className="mobile-scroll-actions justify-end lg:flex lg:flex-wrap lg:overflow-visible">
      <button onClick={onView} aria-label="مشاهده" title="مشاهده"
        className={`${enabledCls} text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20`}>
        <Eye className="h-4 w-4" />
      </button>
      {(status === 'draft' || status === 'changes_requested') && (
        <button onClick={onEdit} aria-label="ویرایش" title="ویرایش"
          className={`${enabledCls} text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700`}>
          <Edit2 className="h-4 w-4" />
        </button>
      )}
      {canSend ? (
        <button
          onClick={onSendForApproval}
          disabled={sendingId === id}
          aria-label="ارسال برای تأیید" title="ارسال برای تأیید"
          className={`${enabledCls} text-amber-500 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-amber-900/20`}
        >
          {sendingId === id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      ) : (
        <span className={disabledCls} title="ارسال در وضعیت فعلی ممکن نیست">
          <Send className="h-4 w-4" />
        </span>
      )}
      <button
        onClick={onPrint}
        disabled={printingId === id}
        aria-label="چاپ" title="چاپ"
        className={`${enabledCls} text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-700`}
      >
        {printingId === id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
      </button>
      {status === 'draft' && (
        <button onClick={onDelete} aria-label="حذف" title="حذف"
          className={`${enabledCls} text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20`}>
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
