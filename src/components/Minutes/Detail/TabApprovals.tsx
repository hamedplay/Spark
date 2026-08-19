import { useEffect, useMemo, useState } from 'react';
import { X, Plus, UserCheck, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { EmptyState, ApprovalStatusBadge } from '../MinutesShared';
import { formatClauseLabel, getDecisionRowClauses, getParentDecisionRows } from '../decisionHierarchy';
import type { MinuteDetail, AgendaResultRow, ApprovalRow, ApprovalCommentRow, InternalParticipantRow } from './types';

interface ChangeTargetDecision {
  id: string;
  parent_decision_id: string | null;
  clause_order: number | null;
  title: string;
  description: string | null;
}

async function fetchChangeTargetDecisions(minuteId: string): Promise<ChangeTargetDecision[]> {
  const { data, error } = await supabase.rpc('get_minutes_decisions_for_view', { p_minute_id: minuteId });
  if (error) throw error;
  return ((data || []) as unknown as ChangeTargetDecision[]);
}

function decisionTargetLabel(decisions: ChangeTargetDecision[], decisionId: string | null): string | null {
  if (!decisionId) return null;
  const target = decisions.find(decision => decision.id === decisionId);
  if (!target) return null;

  const parents = getParentDecisionRows(decisions);
  if (!target.parent_decision_id) {
    const parentIndex = parents.findIndex(parent => parent.id === target.id);
    return `${parentIndex >= 0 ? `مصوبه ${(parentIndex + 1).toLocaleString('fa-IR')}` : 'مصوبه'}: ${target.description || target.title}`;
  }

  const parentIndex = parents.findIndex(parent => parent.id === target.parent_decision_id);
  return `${parentIndex >= 0 ? `مصوبه ${(parentIndex + 1).toLocaleString('fa-IR')} ـ ` : ''}${formatClauseLabel(target.clause_order)}: ${target.description || target.title}`;
}

export interface TabApprovalsProps {
  approvals: ApprovalRow[];
  comments: ApprovalCommentRow[];
  agendaItems: AgendaResultRow[];
  minute: MinuteDetail;
  internalParticipants: InternalParticipantRow[];
}

export function TabApprovals({ approvals, comments, agendaItems, minute, internalParticipants }: TabApprovalsProps) {
  const approvedCount = approvals.filter(a => a.status === 'approved').length;
  const totalCount = approvals.length;
  const [decisionTargets, setDecisionTargets] = useState<ChangeTargetDecision[]>([]);
  const [commentDecisionIds, setCommentDecisionIds] = useState<Record<string, string | null>>({});

  useEffect(() => {
    if (comments.length === 0) {
      setCommentDecisionIds({});
      setDecisionTargets([]);
      return;
    }

    let cancelled = false;
    void Promise.all([
      fetchChangeTargetDecisions(minute.id),
      supabase
        .from('minutes_approval_comments')
        .select('id, decision_id')
        .eq('minute_id', minute.id)
        .eq('revision_number', minute.revision_number),
    ]).then(([decisions, commentResult]) => {
      if (cancelled) return;
      setDecisionTargets(decisions);
      if (commentResult.error) return;
      setCommentDecisionIds(Object.fromEntries(
        (commentResult.data || []).map((row: { id: string; decision_id: string | null }) => [row.id, row.decision_id]),
      ));
    }).catch(() => {
      if (!cancelled) {
        setDecisionTargets([]);
        setCommentDecisionIds({});
      }
    });

    return () => { cancelled = true; };
  }, [comments.length, minute.id, minute.revision_number]);

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        وضعیت تأییدها
      </h2>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{approvedCount}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">تأییدشده</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalCount}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">کل تأییدکنندگان</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{minute.revision_number}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">نسخه فعلی</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-center">
          <p className="text-sm font-bold text-gray-900 dark:text-white">
            {minute.secretary_confirmed_at ? 'بله' : 'خیر'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">تأیید دبیر</p>
        </div>
      </div>

      {/* Approvals list */}
      {approvals.length === 0 && minute.approval_mode === 'system' ? (
        (() => {
          const eligibleApprovers = internalParticipants.filter(p => !!p.user_id);
          if (eligibleApprovers.length === 0) {
            return <EmptyState title="بدون تأییدکننده" description="هیچ شرکت‌کننده داخلی با حساب کاربری وجود ندارد." />;
          }
          return (
            <div className="space-y-3">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded-xl p-3 text-xs text-blue-700 dark:text-blue-400">
                صورت‌جلسه هنوز ارسال نشده است. پس از ارسال، تأییدکنندگان زیر به‌صورت خودکار ساخته می‌شوند.
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                <ul className="divide-y divide-gray-50 dark:divide-gray-700">
                  {eligibleApprovers.map((p, idx) => (
                    <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                        {idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{p.name_snapshot}</p>
                        {(p.position_snapshot || p.org_unit_name_snapshot) && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {[p.position_snapshot, p.org_unit_name_snapshot].filter(Boolean).join(' — ')}
                          </p>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">تأیید سیستمی</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })()
      ) : approvals.length === 0 ? (
        <EmptyState title="بدون تأییدکننده" description={minute.approval_mode === 'in_person' ? 'در مدل حضوری تأیید سیستمی شرکت‌کنندگان وجود ندارد.' : 'هنوز تأییدکننده‌ای ثبت نشده است.'} />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">تأییدکننده</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">جانشین</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">اقدام‌کننده</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">وضعیت</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">تاریخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {approvals.map(a => (
                <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{a.approver_name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {a.delegate_user_id ? (
                      <div className="flex items-center gap-1.5">
                        <UserCheck className="w-3.5 h-3.5 text-blue-500" />
                        <span>{a.delegate_name}</span>
                        {a.delegated_at && (
                          <span className="text-xs text-gray-400">{new Date(a.delegated_at).toLocaleDateString('fa-IR')}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {a.acted_by_user_id ? (
                      <span className={a.acted_by_user_id === a.approver_user_id ? '' : 'text-blue-600 dark:text-blue-400'}>
                        {a.acted_by_name}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3"><ApprovalStatusBadge status={a.status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {a.approved_at ? new Date(a.approved_at).toLocaleDateString('fa-IR') :
                     a.changes_requested_at ? new Date(a.changes_requested_at).toLocaleDateString('fa-IR') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Change requests */}
      {comments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">درخواست‌های اصلاح</h3>
          {comments.map(c => {
            const decisionLabel = decisionTargetLabel(decisionTargets, commentDecisionIds[c.id] || null);
            const agenda = c.agenda_result_id ? agendaItems.find(ag => ag.id === c.agenda_result_id) : null;
            return (
              <div key={c.id} className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-900/40 rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="font-medium text-orange-700 dark:text-orange-400">{c.created_by_name}</span>
                  <span>•</span>
                  <span>{new Date(c.created_at).toLocaleDateString('fa-IR')}</span>
                </div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {decisionLabel || (agenda ? `بند: ${agenda.agenda_title_snapshot}` : 'اعتراض کلی')}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400"><span className="font-medium">علت:</span> {c.reason}</p>
                {c.suggested_correction && (
                  <p className="text-sm text-gray-600 dark:text-gray-400"><span className="font-medium">پیشنهاد اصلاح:</span> {c.suggested_correction}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

// ── Request Changes Modal ─────────────────────────────────────────────────────

export interface RequestChangesModalProps {
  minute: MinuteDetail;
  agendaItems: AgendaResultRow[];
  onClose: () => void;
  onSubmitted: () => void;
  currentUserId?: string;
}

interface ChangeItem {
  decision_id: string | null;
  reason: string;
  suggested_correction: string;
}

export function RequestChangesModal({ minute, onClose, onSubmitted }: RequestChangesModalProps) {
  const [items, setItems] = useState<ChangeItem[]>([{ decision_id: null, reason: '', suggested_correction: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [decisions, setDecisions] = useState<ChangeTargetDecision[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [targetsError, setTargetsError] = useState(false);

  const parentDecisions = useMemo(() => getParentDecisionRows(decisions), [decisions]);

  useEffect(() => {
    let cancelled = false;
    setTargetsLoading(true);
    setTargetsError(false);
    void fetchChangeTargetDecisions(minute.id)
      .then(rows => {
        if (!cancelled) setDecisions(rows);
      })
      .catch(() => {
        if (!cancelled) {
          setDecisions([]);
          setTargetsError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setTargetsLoading(false);
      });
    return () => { cancelled = true; };
  }, [minute.id]);

  const addItem = () => setItems(prev => [...prev, { decision_id: null, reason: '', suggested_correction: '' }]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: keyof ChangeItem, value: string | null) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));

  const handleSubmit = async () => {
    if (submitting) return;
    for (const item of items) {
      if (!item.reason.trim()) {
        toast.error('علت برای هر مورد اجباری است.');
        return;
      }
      if (!item.decision_id && !item.suggested_correction.trim()) {
        toast.error('برای اعتراض کلی، پیشنهاد اصلاح اجباری است.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('request_minutes_changes', {
        p_minute_id: minute.id,
        p_revision_number: minute.revision_number,
        p_items: items.map(it => ({
          decision_id: it.decision_id || null,
          agenda_result_id: null,
          reason: it.reason,
          suggested_correction: it.suggested_correction || null,
        })),
      });
      if (rpcError) { toast.error('درخواست اصلاح ناموفق بود.'); return; }
      if (data?.success === false) {
        const msgs: Record<string, string> = {
          NOT_AN_APPROVER: 'شما تأییدکننده این صورت‌جلسه نیستید.',
          MINUTE_NOT_PENDING: 'صورت‌جلسه در وضعیت تأیید نیست.',
          REVISION_NOT_CURRENT: 'این نسخه دیگر معتبر نیست.',
          APPROVAL_NOT_PENDING: 'درخواست اصلاح شما قبلاً ثبت شده یا باطل شده است.',
          APPROVAL_NOT_SYSTEM_MODE: 'این صورت‌جلسه از نوع سیستمی نیست.',
          NO_CHANGE_ITEMS: 'حداقل یک مورد لازم است.',
          REASON_REQUIRED: 'علت اجباری است.',
          DECISION_MISMATCH: 'مصوبه یا بند انتخاب‌شده متعلق به این صورت‌جلسه نیست.',
          CHANGE_TARGET_AMBIGUOUS: 'برای هر مورد فقط یک مصوبه یا بند قابل انتخاب است.',
          AGENDA_RESULT_MISMATCH: 'بند انتخاب‌شده متعلق به این صورت‌جلسه نیست.',
          GENERAL_OBJECTION_NEEDS_CORRECTION: 'برای اعتراض کلی پیشنهاد اصلاح اجباری است.',
        };
        toast.error(msgs[data.error_code] || 'درخواست اصلاح ناموفق بود.');
        return;
      }
      toast.success(data.message || 'درخواست اصلاح ثبت شد.');
      onSubmitted();
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">درخواست اصلاح</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">مصوبه یا بند مورد اعتراض و علت اصلاح را وارد کنید.</p>
          {items.map((item, idx) => (
            <div key={idx} className="space-y-2 border border-gray-100 dark:border-gray-700 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">مورد {idx + 1}</span>
                {items.length > 1 && (
                  <button onClick={() => removeItem(idx)} className="text-xs text-red-500 hover:text-red-600">حذف</button>
                )}
              </div>
              <select
                value={item.decision_id || ''}
                onChange={e => updateItem(idx, 'decision_id', e.target.value || null)}
                disabled={targetsLoading || targetsError}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white disabled:opacity-60"
              >
                <option value="">
                  {targetsLoading ? 'در حال بارگذاری مصوبات...' : targetsError ? 'بارگذاری مصوبات ناموفق بود' : 'اعتراض کلی (بدون مصوبه/بند خاص)'}
                </option>
                {!targetsLoading && !targetsError && parentDecisions.map((parent, parentIndex) => {
                  const clauses = getDecisionRowClauses(decisions, parent.id);
                  const parentLabel = parent.description || parent.title;
                  return (
                    <optgroup key={parent.id} label={`مصوبه ${(parentIndex + 1).toLocaleString('fa-IR')} ـ ${parentLabel}`}>
                      <option value={parent.id}>{`کل مصوبه ${(parentIndex + 1).toLocaleString('fa-IR')}: ${parentLabel}`}</option>
                      {clauses.map(clause => (
                        <option key={clause.id} value={clause.id}>
                          {`${formatClauseLabel(clause.clause_order)}: ${clause.description || clause.title}`}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
              <textarea
                value={item.reason}
                onChange={e => updateItem(idx, 'reason', e.target.value)}
                placeholder="علت اعتراض (اجباری)"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white resize-none"
              />
              <textarea
                value={item.suggested_correction}
                onChange={e => updateItem(idx, 'suggested_correction', e.target.value)}
                placeholder="پیشنهاد اصلاح (برای اعتراض کلی اجباری)"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white resize-none"
              />
            </div>
          ))}
          <button onClick={addItem} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
            <Plus className="w-4 h-4" /> افزودن مورد دیگر
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200">انصراف</button>
          <button
            onClick={handleSubmit}
            disabled={submitting || targetsLoading || targetsError}
            className="px-4 py-2 rounded-xl text-sm bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50"
          >
            {submitting ? 'در حال ارسال...' : 'ثبت درخواست اصلاح'}
          </button>
        </div>
      </div>
    </div>
  );
}
