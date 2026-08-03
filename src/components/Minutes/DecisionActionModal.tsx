import { useState } from 'react';
import { X, Loader as Loader2 } from 'lucide-react';
import moment from 'moment-jalaali';
import { supabase } from '../../lib/supabase';
import { DecisionStatusBadge, DecisionProgressBar } from './MinutesShared';
import { JalaliDatePicker } from './Form/JalaliDatePicker';
import type { DecisionRow, DecisionStatus } from './types';
import { DECISION_STATUS_LABELS } from './decisionHelpers';
import { toPersianDigits } from '../../lib/minutesDate';
import { parseRpcResult } from './decisionRpc';

function jalaliToIsoUtc(jalaliDate: string, time: string): string {
  const m = moment(`${jalaliDate} ${time}`, 'jYYYY/jMM/jDD HH:mm');
  if (!m.isValid()) return '';
  return m.toISOString();
}

export type ActionType =
  | 'progress'
  | 'status'
  | 'report'
  | 'obstacle'
  | 'followup'
  | 'complete'
  | 'reopen'
  | 'obstacle_resolved'
  | 'update';

interface DecisionActionModalProps {
  decision: DecisionRow;
  action: ActionType;
  obstacleUpdateId?: string | null;
  isManager?: boolean;
  onClose: () => void;
  onSuccess: (updatedAt?: string) => void;
}

const OWNER_STATUSES: DecisionStatus[] = [
  'not_started','planned','in_progress','waiting_coordination','waiting_approval','stopped',
];
const MANAGER_STATUSES: DecisionStatus[] = [
  'not_started','planned','in_progress','waiting_coordination','waiting_approval','stopped',
];
const REOPEN_STATUSES: DecisionStatus[] = [
  'not_started','planned','in_progress','waiting_coordination','waiting_approval',
];
const FOLLOWUP_METHODS = [
  { value: 'phone',   label: 'تلفن' },
  { value: 'letter',  label: 'مکاتبه' },
  { value: 'meeting', label: 'جلسه' },
  { value: 'message', label: 'پیام' },
  { value: 'other',   label: 'سایر' },
];
const OBSTACLE_CATEGORIES = [
  { value: 'technical',     label: 'فنی' },
  { value: 'financial',     label: 'مالی' },
  { value: 'coordination',  label: 'هماهنگی' },
  { value: 'approval',      label: 'تأیید' },
  { value: 'resource',      label: 'منابع' },
  { value: 'external',      label: 'عوامل خارجی' },
  { value: 'other',         label: 'سایر' },
];
const OBSTACLE_SEVERITIES = [
  { value: 'low',      label: 'کم' },
  { value: 'medium',   label: 'متوسط' },
  { value: 'high',     label: 'زیاد' },
  { value: 'critical', label: 'بحرانی' },
];

function getActionTitle(action: ActionType): string {
  switch (action) {
    case 'progress':          return 'ثبت پیشرفت';
    case 'status':            return 'تغییر وضعیت';
    case 'report':            return 'ثبت گزارش';
    case 'obstacle':          return 'ثبت مانع';
    case 'followup':          return 'ثبت پیگیری';
    case 'complete':          return 'تکمیل مصوبه';
    case 'reopen':            return 'بازگشایی مصوبه';
    case 'obstacle_resolved': return 'رفع مانع';
    case 'update':            return 'به‌روزرسانی مصوبه';
  }
}

export function DecisionActionModal({
  decision, action, obstacleUpdateId, isManager = false,
  onClose, onSuccess,
}: DecisionActionModalProps) {
  const [progress, setProgress]       = useState(decision.progress_percent);
  const [reportText, setReportText]   = useState('');
  const [newStatus, setNewStatus]     = useState<DecisionStatus>(decision.status);
  const [obsTitle, setObsTitle]       = useState('');
  const [obsDesc, setObsDesc]         = useState('');
  const [obsCategory, setObsCategory] = useState('other');
  const [obsSeverity, setObsSeverity] = useState('medium');
  const [followupMethod, setFollupMethod] = useState('phone');
  const [followupResult, setFollupResult] = useState('');
  const [followupDate, setFollupDate]  = useState<string | null>(null);
  const [followupTime, setFollupTime]  = useState<string>('09:00');
  const [reopenStatus, setReopenStatus] = useState<DecisionStatus>('in_progress');
  const [reopenReason, setReopenReason] = useState('');
  const [resolveNotes, setResolveNotes] = useState('');

  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);

    // Client-side validations
    if (action === 'progress' && reportText.trim().length < 3 && progress !== decision.progress_percent) {
      setError('متن گزارش هنگام تغییر پیشرفت اجباری است (حداقل ۳ کاراکتر).');
      return;
    }
    if (action === 'report' && reportText.trim().length < 3) {
      setError('متن گزارش باید حداقل ۳ کاراکتر باشد.');
      return;
    }
    if (action === 'obstacle' && obsTitle.trim().length < 2) {
      setError('عنوان مانع اجباری است.');
      return;
    }
    if (action === 'reopen' && reopenReason.trim().length < 3) {
      setError('دلیل بازگشایی اجباری است.');
      return;
    }
    if (action === 'followup' && followupResult.trim().length < 2) {
      setError('نتیجه پیگیری اجباری است.');
      return;
    }
    if (action === 'followup' && followupDate) {
      const [h, m] = followupTime.split(':').map(Number);
      if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
        setError('ساعت یادآور معتبر نیست.');
        return;
      }
    }

    setSubmitting(true);
    try {
      // ── Owner operations: update_my_minutes_decision ──────────────────────
      if (action === 'update' || action === 'progress' || action === 'report' || action === 'complete') {
        // 'update' is the combined action: status + progress + report in one submit.
        // The RPC's existing logic determines the real event type from the actual change.
        const isCompletion = action === 'complete' || (action === 'update' && newStatus === 'completed');
        const eventType = isCompletion ? 'completion'
                        : action === 'report' ? 'report'
                        : 'progress';
        const pStatus = isCompletion ? 'completed' : (action === 'update' ? newStatus : decision.status);
        const pProgress = isCompletion ? 100 : progress;

        // Prevent reducing progress from 100% without reopening
        if (action === 'update' && decision.status === 'completed' && pProgress < 100) {
          setError('کاهش پیشرفت از ۱۰۰٪ بدون بازگشایی مجاز نیست.');
          setSubmitting(false);
          return;
        }

        const { data, error: rpcErr } = await supabase.rpc('update_my_minutes_decision', {
          p_decision_id: decision.id,
          p_expected_updated_at: decision.updated_at,
          p_progress_percent: pProgress,
          p_status: pStatus,
          p_report_text: reportText || null,
          p_event_type: eventType,
        });

        const parsed = parseRpcResult(data, rpcErr);
        if (!parsed.ok) { setError(parsed.error ?? 'خطا'); return; }
        onSuccess(parsed.updatedAt);
        return;
      }

      // ── Owner obstacle ─────────────────────────────────────────────────────
      if (action === 'obstacle' && !isManager) {
        const { data, error: rpcErr } = await supabase.rpc('update_my_minutes_decision', {
          p_decision_id: decision.id,
          p_expected_updated_at: decision.updated_at,
          p_report_text: obsDesc || null,
          p_event_type: 'obstacle',
          p_event_title: obsTitle,
          p_event_metadata: { category: obsCategory, severity: obsSeverity },
        });

        const parsed = parseRpcResult(data, rpcErr);
        if (!parsed.ok) { setError(parsed.error ?? 'خطا'); return; }
        onSuccess(parsed.updatedAt);
        return;
      }

      // ── Owner status change: update_my_minutes_decision ─────────────────
      if (action === 'status' && !isManager) {
        const { data, error: rpcErr } = await supabase.rpc('update_my_minutes_decision', {
          p_decision_id: decision.id,
          p_expected_updated_at: decision.updated_at,
          p_progress_percent: decision.progress_percent,
          p_status: newStatus,
          p_report_text: reportText || null,
          p_event_type: 'status_change',
        });

        const parsed = parseRpcResult(data, rpcErr);
        if (!parsed.ok) { setError(parsed.error ?? 'خطا'); return; }
        onSuccess(parsed.updatedAt);
        return;
      }

      // ── Manager status change: manage_minutes_decision ───────────────────
      if (action === 'status' && isManager) {
        const { data, error: rpcErr } = await supabase.rpc('manage_minutes_decision', {
          p_decision_id: decision.id,
          p_expected_updated_at: decision.updated_at,
          p_operation: 'status_change',
          p_new_status: newStatus,
          p_report_text: reportText || null,
        });

        const parsed = parseRpcResult(data, rpcErr);
        if (!parsed.ok) { setError(parsed.error ?? 'خطا'); return; }
        onSuccess(parsed.updatedAt);
        return;
      }

      if (action === 'obstacle' && isManager) {
        const { data, error: rpcErr } = await supabase.rpc('manage_minutes_decision', {
          p_decision_id: decision.id,
          p_expected_updated_at: decision.updated_at,
          p_operation: 'obstacle',
          p_event_title: obsTitle,
          p_report_text: obsDesc || null,
          p_event_metadata: { category: obsCategory, severity: obsSeverity },
        });

        const parsed = parseRpcResult(data, rpcErr);
        if (!parsed.ok) { setError(parsed.error ?? 'خطا'); return; }
        onSuccess(parsed.updatedAt);
        return;
      }

      if (action === 'followup') {
        // Build p_remind_at from Jalali date + time, converted to ISO UTC
        let pRemindAt: string | undefined;
        if (followupDate) {
          pRemindAt = jalaliToIsoUtc(followupDate, followupTime) || undefined;
        }

        const { data, error: rpcErr } = await supabase.rpc('manage_minutes_decision', {
          p_decision_id: decision.id,
          p_expected_updated_at: decision.updated_at,
          p_operation: 'followup',
          p_report_text: followupResult,
          p_event_metadata: {
            method: followupMethod,
            result: followupResult,
            next_followup_date: followupDate ?? undefined,
            next_followup_time: followupTime,
          },
          p_remind_at: pRemindAt ?? null,
        });

        const parsed = parseRpcResult(data, rpcErr);
        if (!parsed.ok) { setError(parsed.error ?? 'خطا'); return; }
        onSuccess(parsed.updatedAt);
        return;
      }

      if (action === 'reopen') {
        const { data, error: rpcErr } = await supabase.rpc('manage_minutes_decision', {
          p_decision_id: decision.id,
          p_expected_updated_at: decision.updated_at,
          p_operation: 'reopened',
          p_new_status: reopenStatus,
          p_report_text: reopenReason,
        });

        const parsed = parseRpcResult(data, rpcErr);
        if (!parsed.ok) { setError(parsed.error ?? 'خطا'); return; }
        onSuccess(parsed.updatedAt);
        return;
      }

      if (action === 'obstacle_resolved') {
        if (isManager) {
          const { data, error: rpcErr } = await supabase.rpc('manage_minutes_decision', {
            p_decision_id: decision.id,
            p_expected_updated_at: decision.updated_at,
            p_operation: 'obstacle_resolved',
            p_report_text: resolveNotes || null,
            p_obstacle_update_id: obstacleUpdateId ?? null,
          });

          const parsed = parseRpcResult(data, rpcErr);
          if (!parsed.ok) { setError(parsed.error ?? 'خطا'); return; }
          onSuccess(parsed.updatedAt);
          return;
        } else {
          const { data, error: rpcErr } = await supabase.rpc('resolve_my_minutes_decision_obstacle', {
            p_decision_id: decision.id,
            p_expected_updated_at: decision.updated_at,
            p_obstacle_update_id: obstacleUpdateId,
            p_resolution_notes: resolveNotes || null,
          });

          const parsed = parseRpcResult(data, rpcErr);
          if (!parsed.ok) { setError(parsed.error ?? 'خطا'); return; }
          onSuccess(parsed.updatedAt);
          return;
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطای ناشناخته');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{getActionTitle(action)}</h2>
          <button onClick={onClose} disabled={submitting} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <DecisionStatusBadge status={decision.status} />
            <span className="text-xs text-gray-400">{toPersianDigits(String(decision.progress_percent))}٪</span>
          </div>

          {action === 'complete' && (
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded-xl p-3 text-sm text-blue-700 dark:text-blue-400">
              با تکمیل مصوبه، درصد پیشرفت به ۱۰۰٪ تغییر خواهد کرد.
            </div>
          )}

          {action === 'update' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">وضعیت جدید</label>
                <select value={newStatus} onChange={e => setNewStatus(e.target.value as DecisionStatus)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40">
                  {(isManager ? MANAGER_STATUSES : OWNER_STATUSES).map(s => (
                    <option key={s} value={s}>{DECISION_STATUS_LABELS[s]}</option>
                  ))}
                </select>
                {newStatus === 'completed' && (
                  <div className="mt-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded-xl p-3 text-sm text-blue-700 dark:text-blue-400">
                    با انتخاب وضعیت «تکمیل‌شده»، درصد پیشرفت به ۱۰۰٪ تغییر خواهد کرد.
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  درصد پیشرفت: {toPersianDigits(String(newStatus === 'completed' ? 100 : progress))}٪
                </label>
                {newStatus !== 'completed' && (
                  <input type="range" min={0} max={100} value={progress}
                    onChange={e => setProgress(Number(e.target.value))}
                    className="w-full accent-blue-600" />
                )}
                <DecisionProgressBar percent={newStatus === 'completed' ? 100 : progress} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  متن گزارش یا توضیح تغییر {progress !== decision.progress_percent || newStatus !== decision.status ? <span className="text-red-500">*</span> : '(اختیاری)'}
                </label>
                <textarea value={reportText} onChange={e => setReportText(e.target.value)} rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
              </div>
            </>
          )}

          {(action === 'progress' || action === 'complete') && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  درصد پیشرفت: {toPersianDigits(String(action === 'complete' ? 100 : progress))}٪
                </label>
                {action !== 'complete' && (
                  <input type="range" min={0} max={100} value={progress}
                    onChange={e => setProgress(Number(e.target.value))}
                    className="w-full accent-blue-600" />
                )}
                <DecisionProgressBar percent={action === 'complete' ? 100 : progress} />
              </div>
              {action !== 'complete' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    متن گزارش {progress !== decision.progress_percent ? <span className="text-red-500">*</span> : '(اختیاری)'}
                  </label>
                  <textarea value={reportText} onChange={e => setReportText(e.target.value)} rows={3}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
                </div>
              )}
            </>
          )}

          {action === 'status' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">وضعیت جدید</label>
                <select value={newStatus} onChange={e => setNewStatus(e.target.value as DecisionStatus)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40">
                  {(isManager ? MANAGER_STATUSES : OWNER_STATUSES).map(s => (
                    <option key={s} value={s}>{DECISION_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">توضیح (اختیاری)</label>
                <textarea value={reportText} onChange={e => setReportText(e.target.value)} rows={2}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
              </div>
            </>
          )}

          {action === 'report' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                متن گزارش <span className="text-red-500">*</span>
              </label>
              <textarea value={reportText} onChange={e => setReportText(e.target.value)} rows={4}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
            </div>
          )}

          {action === 'obstacle' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">عنوان مانع <span className="text-red-500">*</span></label>
                <input type="text" value={obsTitle} onChange={e => setObsTitle(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شرح</label>
                <textarea value={obsDesc} onChange={e => setObsDesc(e.target.value)} rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">دسته‌بندی</label>
                  <select value={obsCategory} onChange={e => setObsCategory(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40">
                    {OBSTACLE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شدت</label>
                  <select value={obsSeverity} onChange={e => setObsSeverity(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40">
                    {OBSTACLE_SEVERITIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
            </>
          )}

          {action === 'followup' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">روش پیگیری</label>
                <select value={followupMethod} onChange={e => setFollupMethod(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40">
                  {FOLLOWUP_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ پیگیری بعدی (اختیاری)</label>
                <JalaliDatePicker value={followupDate} onChange={setFollupDate} placeholder="انتخاب تاریخ" />
              </div>
              {followupDate && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ساعت یادآور</label>
                  <input type="time" value={followupTime} onChange={e => setFollupTime(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
                  <p className="text-xs text-gray-400 mt-1">یادآور در این ساعت به مسئول مصوبه ارسال خواهد شد.</p>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نتیجه پیگیری <span className="text-red-500">*</span></label>
                <textarea value={followupResult} onChange={e => setFollupResult(e.target.value)} rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
              </div>
            </>
          )}

          {action === 'reopen' && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">وضعیت پس از بازگشایی</label>
                <select value={reopenStatus} onChange={e => setReopenStatus(e.target.value as DecisionStatus)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40">
                  {REOPEN_STATUSES.map(s => <option key={s} value={s}>{DECISION_STATUS_LABELS[s]}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">دلیل بازگشایی <span className="text-red-500">*</span></label>
                <textarea value={reopenReason} onChange={e => setReopenReason(e.target.value)} rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
              </div>
            </>
          )}

          {action === 'obstacle_resolved' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">یادداشت (اختیاری)</label>
              <textarea value={resolveNotes} onChange={e => setResolveNotes(e.target.value)} rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-900/40 rounded-xl p-3 text-sm text-red-700 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-700 justify-end shrink-0">
          <button onClick={onClose} disabled={submitting}
            className="px-4 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50">
            انصراف
          </button>
          <button onClick={handleSubmit} disabled={submitting}
            className="px-5 py-2 text-sm font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            ثبت
          </button>
        </div>
      </div>
    </div>
  );
}
