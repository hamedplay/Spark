import { useEffect, useState } from 'react';
import { TriangleAlert as AlertTriangle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { EmptyState, TableSkeleton, DecisionStatusBadge, DecisionPriorityBadge, DecisionProgressBar, DecisionProgressModal } from '../MinutesShared';
import type { MinutesStatus, DecisionRow, DecisionUpdateRow } from '../types';

export interface TabDecisionsProps {
  minuteId: string;
  minuteStatus: MinutesStatus;
  secretaryId: string | null;
  chairId: string | null;
  currentUserId?: string;
  isAdmin?: boolean;
}

interface ViewDecisionRow {
  id: string;
  title: string;
  description: string | null;
  priority: DecisionRow['priority'];
  status: DecisionRow['status'];
  progress_percent: number;
  start_date: string | null;
  due_date: string | null;
  responsible_unit_name_snapshot: string | null;
  primary_owner_user_id: string;
  owner_name: string | null;
  requires_followup: boolean;
  latest_update: string | null;
  agenda_result_id: string | null;
  agenda_title: string | null;
}

export function TabDecisions({ minuteId, minuteStatus, secretaryId, chairId, currentUserId, isAdmin }: TabDecisionsProps) {
  const [decisions, setDecisions] = useState<ViewDecisionRow[]>([]);
  const [historyMap, setHistoryMap] = useState<Record<string, DecisionUpdateRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progressDecision, setProgressDecision] = useState<DecisionRow | null>(null);
  const [progressHistory, setProgressHistory] = useState<DecisionUpdateRow[]>([]);

  const canUpdateStatus = minuteStatus === 'approved' || minuteStatus === 'published';

  const canUpdateDecision = (dec: ViewDecisionRow | DecisionRow) => {
    if (!currentUserId) return false;
    if (isAdmin) return true;
    if (dec.primary_owner_user_id === currentUserId) return true;
    if (secretaryId && secretaryId === currentUserId) return true;
    if (chairId && chairId === currentUserId) return true;
    return false;
  };

  const isManager = (dec: ViewDecisionRow | DecisionRow) => {
    if (!currentUserId) return false;
    if (isAdmin) return true;
    if (secretaryId && secretaryId === currentUserId) return true;
    if (chairId && chairId === currentUserId) return true;
    return false;
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [viewRes, histRes] = await Promise.all([
        supabase.rpc('get_minutes_decisions_for_view', { p_minute_id: minuteId }),
        supabase
          .from('minutes_decision_updates')
          .select('id, decision_id, minute_id, previous_status, new_status, previous_progress_percent, new_progress_percent, update_text, created_by_user_id, created_at, event_type, event_title, event_metadata, is_blocking, resolved_at, resolved_by_user_id')
          .eq('minute_id', minuteId)
          .order('created_at', { ascending: false }),
      ]);

      if (viewRes.error) throw new Error('decisions');
      if (histRes.error) throw new Error('history');

      const viewRows = (viewRes.data || []) as unknown as ViewDecisionRow[];
      const histRows = (histRes.data || []) as unknown as DecisionUpdateRow[];

      const hMap: Record<string, DecisionUpdateRow[]> = {};
      for (const h of histRows) {
        if (!hMap[h.decision_id]) hMap[h.decision_id] = [];
        hMap[h.decision_id].push(h);
      }
      setHistoryMap(hMap);
      setDecisions(viewRows);
    } catch {
      setError('بارگذاری مصوبات ناموفق بود. لطفاً دوباره تلاش کنید.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minuteId]);

  const openProgressModal = (dec: ViewDecisionRow) => {
    const fullDec: DecisionRow = {
      id: dec.id,
      minute_id: minuteId,
      agenda_result_id: dec.agenda_result_id,
      title: dec.title,
      description: dec.description,
      primary_owner_user_id: dec.primary_owner_user_id,
      responsible_unit_id: null,
      responsible_unit_name_snapshot: dec.responsible_unit_name_snapshot,
      priority: dec.priority,
      status: dec.status,
      progress_percent: dec.progress_percent,
      start_date: dec.start_date,
      due_date: dec.due_date,
      completed_at: null,
      requires_followup: dec.requires_followup,
      latest_update: dec.latest_update,
      created_by_user_id: dec.primary_owner_user_id,
      created_at: '',
      updated_at: '',
      discussion_result: null,
      result_type: null,
      additional_notes: null,
    };
    setProgressDecision(fullDec);
    setProgressHistory(historyMap[dec.id] || []);
  };

  const onProgressUpdated = () => {
    setProgressDecision(null);
    fetchData();
  };

  if (loading) return <TableSkeleton rows={3} />;
  if (error) return <EmptyState title="خطا" description={error} />;
  if (decisions.length === 0) return <EmptyState title="مصوبه‌ای ثبت نشده" description="هنوز مصوبه‌ای برای این صورت‌جلسه ثبت نشده است." />;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        مصوبات و اقدامات ({decisions.length})
      </h2>
      {!canUpdateStatus && (
        <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3 text-xs text-gray-500 dark:text-gray-400">
          به‌روزرسانی پیشرفت فقط در صورت‌جلسه‌های تأییدشده یا منتشرشده ممکن است.
        </div>
      )}
      {decisions.map((dec, idx) => {
        const overdue = dec.due_date && dec.status !== 'completed' && dec.status !== 'stopped' && new Date(dec.due_date) < new Date();
        const ownerName = dec.owner_name || '—';
        const hist = historyMap[dec.id] || [];
        return (
          <div key={dec.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <p className="font-semibold text-gray-900 dark:text-white">
                  <span className="text-gray-400 text-sm ml-1">{idx + 1}.</span>
                  {dec.title}
                </p>
                {dec.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{dec.description}</p>}
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <DecisionPriorityBadge priority={dec.priority} />
                <DecisionStatusBadge status={dec.status} />
                {overdue && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    <AlertTriangle className="w-3 h-3" /> سررسید گذشته
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <p className="text-gray-400 mb-0.5">مسئول اصلی</p>
                <p className="text-gray-700 dark:text-gray-300">{ownerName}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">واحد مسئول</p>
                <p className="text-gray-700 dark:text-gray-300">{dec.responsible_unit_name_snapshot || '—'}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">تاریخ شروع</p>
                <p className="text-gray-700 dark:text-gray-300">{dec.start_date || '—'}</p>
              </div>
              <div>
                <p className="text-gray-400 mb-0.5">مهلت</p>
                <p className="text-gray-700 dark:text-gray-300">{dec.due_date || '—'}</p>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 dark:text-gray-400">پیشرفت: {dec.progress_percent}٪</span>
              </div>
              <DecisionProgressBar percent={dec.progress_percent} />
            </div>

            {dec.latest_update && (
              <div className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-2.5 text-xs">
                <p className="text-gray-400 mb-0.5">آخرین گزارش</p>
                <p className="text-gray-600 dark:text-gray-300">{dec.latest_update}</p>
              </div>
            )}

            {hist.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                  تاریخچه به‌روزرسانی‌ها ({hist.length})
                </summary>
                <div className="mt-2 space-y-1.5">
                  {hist.map(h => (
                    <div key={h.id} className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-2">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-gray-500">{h.previous_status ?? '—'} ← {h.new_status} | {h.previous_progress_percent ?? 0}٪ → {h.new_progress_percent}٪</span>
                        <span className="text-gray-400">{new Date(h.created_at).toLocaleDateString('fa-IR')}</span>
                      </div>
                      {h.update_text && <p className="text-gray-600 dark:text-gray-300">{h.update_text}</p>}
                    </div>
                  ))}
                </div>
              </details>
            )}

            {canUpdateStatus && canUpdateDecision(dec) && (
              <div className="pt-1">
                <button
                  onClick={() => openProgressModal(dec)}
                  className="text-xs px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
                >
                  به‌روزرسانی پیشرفت
                </button>
              </div>
            )}
          </div>
        );
      })}

      {progressDecision && (
        <DecisionProgressModal
          decision={progressDecision}
          history={progressHistory}
          canUpdate={canUpdateDecision(progressDecision)}
          isManager={isManager(progressDecision)}
          onClose={() => setProgressDecision(null)}
          onUpdated={onProgressUpdated}
        />
      )}
    </div>
  );
}
