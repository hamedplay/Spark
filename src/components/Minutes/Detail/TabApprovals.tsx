import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { EmptyState, ApprovalStatusBadge } from '../MinutesShared';
import type { MinuteDetail, AgendaResultRow, ApprovalRow, ApprovalCommentRow } from './types';

export interface TabApprovalsProps {
  approvals: ApprovalRow[];
  comments: ApprovalCommentRow[];
  agendaItems: AgendaResultRow[];
  minute: MinuteDetail;
}

export function TabApprovals({ approvals, comments, agendaItems, minute }: TabApprovalsProps) {
  const approvedCount = approvals.filter(a => a.status === 'approved').length;
  const totalCount = approvals.length;

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
      {approvals.length === 0 ? (
        <EmptyState title="بدون تأییدکننده" description={minute.approval_mode === 'in_person' ? 'در مدل حضوری تأیید سیستمی شرکت‌کنندگان وجود ندارد.' : 'هنوز تأییدکننده‌ای ثبت نشده است.'} />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">تأییدکننده</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">وضعیت</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">تاریخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {approvals.map(a => (
                <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{a.approver_name}</td>
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
            const agenda = c.agenda_result_id ? agendaItems.find(ag => ag.id === c.agenda_result_id) : null;
            return (
              <div key={c.id} className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-900/40 rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="font-medium text-orange-700 dark:text-orange-400">{c.created_by_name}</span>
                  <span>•</span>
                  <span>{new Date(c.created_at).toLocaleDateString('fa-IR')}</span>
                </div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {agenda ? `بند: ${agenda.agenda_title_snapshot}` : 'اعتراض کلی'}
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
  agenda_result_id: string | null;
  reason: string;
  suggested_correction: string;
}

export function RequestChangesModal({ minute, agendaItems, onClose, onSubmitted }: RequestChangesModalProps) {
  const [items, setItems] = useState<ChangeItem[]>([{ agenda_result_id: null, reason: '', suggested_correction: '' }]);
  const [submitting, setSubmitting] = useState(false);

  const addItem = () => setItems(prev => [...prev, { agenda_result_id: null, reason: '', suggested_correction: '' }]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: keyof ChangeItem, value: string | null) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));

  const handleSubmit = async () => {
    if (submitting) return;
    // Validate
    for (const item of items) {
      if (!item.reason.trim()) {
        toast.error('علت برای هر مورد اجباری است.');
        return;
      }
      if (!item.agenda_result_id && !item.suggested_correction.trim()) {
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
          agenda_result_id: it.agenda_result_id || null,
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
          <p className="text-sm text-gray-500 dark:text-gray-400">بند یا بندهای مورد اعتراض و علت اصلاح را وارد کنید.</p>
          {items.map((item, idx) => (
            <div key={idx} className="space-y-2 border border-gray-100 dark:border-gray-700 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">مورد {idx + 1}</span>
                {items.length > 1 && (
                  <button onClick={() => removeItem(idx)} className="text-xs text-red-500 hover:text-red-600">حذف</button>
                )}
              </div>
              <select
                value={item.agenda_result_id || ''}
                onChange={e => updateItem(idx, 'agenda_result_id', e.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white"
              >
                <option value="">اعتراض کلی (بدون بند خاص)</option>
                {agendaItems.map(ag => (
                  <option key={ag.id} value={ag.id}>{ag.agenda_title_snapshot}</option>
                ))}
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
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50"
          >
            {submitting ? 'در حال ارسال...' : 'ثبت درخواست اصلاح'}
          </button>
        </div>
      </div>
    </div>
  );
}
