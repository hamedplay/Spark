import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState, TableSkeleton } from '../MinutesShared';
import { listMinuteAudit, AUDIT_ACTION_LABELS, ENTITY_LABELS, summarizeChange, type AuditLogRow } from '../../../lib/minutesAudit';

export interface TabHistoryProps {
  minuteId: string;
}

export function TabHistory({ minuteId }: TabHistoryProps) {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const PAGE = 20;

  const loadInitial = async () => {
    setLoading(true); setError(null);
    try {
      const { rows: r, hasMore: hm } = await listMinuteAudit(minuteId, PAGE, 0);
      setRows(r); setHasMore(hm);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'بارگذاری تاریخچه ناموفق بود.');
    } finally { setLoading(false); }
  };

  useEffect(() => { loadInitial(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [minuteId]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { rows: r, hasMore: hm } = await listMinuteAudit(minuteId, PAGE, rows.length);
      setRows(prev => [...prev, ...r]); setHasMore(hm);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'بارگذاری بیشتر ناموفق بود.');
    } finally { setLoadingMore(false); }
  };

  if (loading) return <TableSkeleton rows={5} />;
  if (error) return <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">{error}</div>;
  if (rows.length === 0) return <EmptyState icon={<History className="w-8 h-8" />} title="هنوز ثبت نشده" description="تاریخچه‌ای برای این صورت‌جلسه ثبت نشده است." />;

  return (
    <div className="space-y-3" dir="rtl">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white">تاریخچه تغییرات</h2>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="divide-y divide-gray-50 dark:divide-gray-700">
          {rows.map(r => (
            <div key={r.id} className="p-4 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                <History className="w-4 h-4 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{AUDIT_ACTION_LABELS[r.action] || r.action}</p>
                  <span className="text-xs text-gray-400 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString('fa-IR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400">{summarizeChange(r)}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                  <span>{r.actor_name || 'سیستم'}</span>
                  {r.revision_number != null && <span>· نسخه {r.revision_number}</span>}
                  {r.entity_type !== 'minute' && <span>· {ENTITY_LABELS[r.entity_type] || r.entity_type}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {hasMore && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'در حال بارگذاری...' : 'بارگذاری بیشتر'}
          </button>
        </div>
      )}
    </div>
  );
}
