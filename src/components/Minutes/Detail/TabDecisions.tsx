import { useEffect, useMemo, useState } from 'react';
import { TriangleAlert as AlertTriangle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import { EmptyState, TableSkeleton, DecisionStatusBadge, DecisionPriorityBadge, DecisionProgressBar, DecisionProgressModal } from '../MinutesShared';
import { formatJalaliDateForDisplay } from '../../../lib/minutesDate';
import type { MinutesStatus, DecisionRow, DecisionUpdateRow } from '../types';
import { formatClauseLabel, getDecisionRowClauses, getParentDecisionRows } from '../decisionHierarchy';

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
  parent_decision_id: string | null;
  clause_order: number | null;
  title: string;
  description: string | null;
  priority: DecisionRow['priority'];
  status: DecisionRow['status'];
  progress_percent: number;
  start_date: string | null;
  due_date: string | null;
  responsible_unit_name_snapshot: string | null;
  primary_owner_user_id: string | null;
  owner_name: string | null;
  requires_followup: boolean;
  latest_update: string | null;
  agenda_result_id: string | null;
  agenda_title: string | null;
  responsible_party_type: 'internal' | 'external';
  external_responsible_participant_id: string | null;
  external_responsible_name_snapshot: string | null;
  external_responsible_organization_snapshot: string | null;
  external_responsible_position_snapshot: string | null;
}

export function TabDecisions({ minuteId, minuteStatus, secretaryId, currentUserId }: TabDecisionsProps) {
  const [decisions, setDecisions] = useState<ViewDecisionRow[]>([]);
  const [historyMap, setHistoryMap] = useState<Record<string, DecisionUpdateRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progressDecision, setProgressDecision] = useState<DecisionRow | null>(null);
  const [progressHistory, setProgressHistory] = useState<DecisionUpdateRow[]>([]);

  const parentDecisions = useMemo(() => getParentDecisionRows(decisions), [decisions]);
  const canUpdateStatus = minuteStatus === 'approved' || minuteStatus === 'published';

  const canUpdateDecision = (dec: ViewDecisionRow | DecisionRow) => {
    if (!currentUserId) return false;
    if (dec.primary_owner_user_id === currentUserId) return true;
    return !!(secretaryId && secretaryId === currentUserId);
  };

  const isManager = () => !!(currentUserId && secretaryId && secretaryId === currentUserId);

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

      if (viewRes.error) {
        console.error('[minutes-decisions] view RPC failed', { code: viewRes.error.code, message: viewRes.error.message });
        throw new Error('decisions');
      }
      if (histRes.error) {
        console.error('[minutes-decisions] history query failed', { code: histRes.error.code, message: histRes.error.message });
        throw new Error('history');
      }

      const viewRows = (viewRes.data || []) as unknown as ViewDecisionRow[];
      const histRows = (histRes.data || []) as unknown as DecisionUpdateRow[];
      const hMap: Record<string, DecisionUpdateRow[]> = {};
      for (const history of histRows) {
        if (!hMap[history.decision_id]) hMap[history.decision_id] = [];
        hMap[history.decision_id].push(history);
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
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minuteId]);

  const openProgressModal = async (dec: ViewDecisionRow) => {
    let updatedAt = '';
    try {
      const { data: row } = await supabase.from('minutes_decisions').select('updated_at').eq('id', dec.id).maybeSingle();
      if (row?.updated_at) updatedAt = row.updated_at;
    } catch {
      // RPC version checking remains the final concurrency guard.
    }
    const fullDec: DecisionRow = {
      id: dec.id,
      minute_id: minuteId,
      agenda_result_id: dec.agenda_result_id,
      parent_decision_id: dec.parent_decision_id,
      clause_order: dec.clause_order,
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
      created_by_user_id: dec.primary_owner_user_id || '',
      created_at: '',
      updated_at: updatedAt,
      discussion_result: null,
      result_type: null,
      additional_notes: null,
      responsible_party_type: dec.responsible_party_type || 'internal',
      external_responsible_participant_id: dec.external_responsible_participant_id,
      external_responsible_name_snapshot: dec.external_responsible_name_snapshot,
      external_responsible_organization_snapshot: dec.external_responsible_organization_snapshot,
      external_responsible_position_snapshot: dec.external_responsible_position_snapshot,
    };
    setProgressDecision(fullDec);
    setProgressHistory(historyMap[dec.id] || []);
  };

  const onProgressUpdated = () => {
    setProgressDecision(null);
    void fetchData();
  };

  const renderExecution = (dec: ViewDecisionRow, nested = false) => {
    const overdue = !!(dec.due_date && dec.status !== 'completed' && dec.status !== 'stopped' && new Date(dec.due_date) < new Date());
    const hist = historyMap[dec.id] || [];
    return (
      <div className={nested ? 'rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/20' : 'space-y-3'}>
        {nested && (
          <div className="mb-3 flex items-start justify-between gap-3">
            <p className="font-medium text-gray-800 dark:text-gray-200">
              <span className="ml-1 text-sm text-blue-600 dark:text-blue-400">{formatClauseLabel(dec.clause_order)} ـ</span>
              {dec.description || dec.title}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <DecisionPriorityBadge priority={dec.priority} />
              <DecisionStatusBadge status={dec.status} />
            </div>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-2 text-xs">
          <div><span className="text-gray-400">واحد مسئول: </span><span className="text-gray-700 dark:text-gray-300">{dec.responsible_unit_name_snapshot || dec.external_responsible_organization_snapshot || '—'}</span></div>
          <div><span className="text-gray-400">مهلت انجام: </span><span className="text-gray-700 dark:text-gray-300">{dec.due_date ? formatJalaliDateForDisplay(dec.due_date) : '—'}</span></div>
          {overdue && <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400"><AlertTriangle className="w-3 h-3" /> سررسید گذشته</span>}
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs"><span className="text-gray-500 dark:text-gray-400">پیشرفت: {dec.progress_percent}٪</span></div>
          <DecisionProgressBar percent={dec.progress_percent} />
        </div>
        {dec.latest_update && <div className="rounded-lg bg-gray-50 p-2.5 text-xs dark:bg-gray-700/30"><p className="mb-0.5 text-gray-400">آخرین گزارش</p><p className="text-gray-600 dark:text-gray-300">{dec.latest_update}</p></div>}
        {hist.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300">تاریخچه به‌روزرسانی‌ها ({hist.length})</summary>
            <div className="mt-2 space-y-1.5">
              {hist.map(history => (
                <div key={history.id} className="rounded-lg bg-gray-50 p-2 dark:bg-gray-700/30">
                  <div className="mb-0.5 flex items-center justify-between"><span className="text-gray-500">{history.previous_progress_percent ?? 0}٪ → {history.new_progress_percent}٪</span><span className="text-gray-400">{new Date(history.created_at).toLocaleDateString('fa-IR')}</span></div>
                  {history.update_text && <p className="text-gray-600 dark:text-gray-300">{history.update_text}</p>}
                </div>
              ))}
            </div>
          </details>
        )}
        {canUpdateStatus && canUpdateDecision(dec) && (
          <div className="pt-1"><button onClick={() => void openProgressModal(dec)} className="rounded-xl bg-blue-50 px-3 py-1.5 text-xs text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40">به‌روزرسانی پیشرفت</button></div>
        )}
      </div>
    );
  };

  if (loading) return <TableSkeleton rows={3} />;
  if (error) return <EmptyState title="خطا" description={error} />;
  if (parentDecisions.length === 0) return <EmptyState title="مصوبه‌ای ثبت نشده" description="هنوز مصوبه‌ای برای این صورت‌جلسه ثبت نشده است." />;

  return (
    <div className="space-y-4">
      <h2 className="border-b border-gray-100 pb-3 text-lg font-bold text-gray-900 dark:border-gray-700 dark:text-white">مصوبات و اقدامات ({parentDecisions.length})</h2>
      {!canUpdateStatus && <div className="rounded-xl bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-700/30 dark:text-gray-400">به‌روزرسانی پیشرفت فقط در صورت‌جلسه‌های تأییدشده یا منتشرشده ممکن است.</div>}

      {parentDecisions.map((parent, index) => {
        const clauses = getDecisionRowClauses(decisions, parent.id);
        return (
          <div key={parent.id} className="space-y-3 rounded-2xl border border-gray-100 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start justify-between gap-3">
              <p className="font-semibold text-gray-900 dark:text-white"><span className="ml-1 text-sm text-gray-400">مصوبه {index + 1} ـ</span>{parent.description || parent.title}</p>
              {clauses.length === 0 ? (
                <div className="flex flex-wrap justify-end gap-2"><DecisionPriorityBadge priority={parent.priority} /><DecisionStatusBadge status={parent.status} /></div>
              ) : (
                <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">{clauses.length.toLocaleString('fa-IR')} بند اجرایی</span>
              )}
            </div>
            {clauses.length === 0 ? renderExecution(parent) : (
              <div className="space-y-2.5 border-r-2 border-blue-100 pr-3 dark:border-blue-900/50">
                {clauses.map(clause => <div key={clause.id}>{renderExecution(clause, true)}</div>)}
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
          isManager={isManager()}
          onClose={() => setProgressDecision(null)}
          onUpdated={onProgressUpdated}
        />
      )}
    </div>
  );
}
