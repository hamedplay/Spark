import { useState } from 'react';
import { X, Loader as Loader2 } from 'lucide-react';
import type { MinutesStatus, ConfidentialityLevel, DecisionStatus, DecisionPriority, ApprovalStatus, ApprovalMode, DecisionRow, DecisionUpdateRow, UpdateDecisionProgressResult } from './types';
import { supabase } from '../../lib/supabase';

// ── DecisionProgressBar ─────────────────────────────────────────────────────

export function DecisionProgressBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const color = clamped >= 100 ? 'bg-green-500' : clamped >= 80 ? 'bg-emerald-500' : clamped >= 40 ? 'bg-blue-500' : 'bg-amber-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 min-w-[4rem]">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400 w-9 text-left">{clamped}٪</span>
    </div>
  );
}

// ── DecisionProgressModal ───────────────────────────────────────────────────
//
// Shared modal for updating decision progress via update_decision_progress RPC.
// Used by MinutesDetailPage, MyDecisionsPage, DecisionsFollowupPage.

interface DecisionProgressModalProps {
  decision: DecisionRow;
  history: DecisionUpdateRow[];
  canUpdate: boolean;
  onClose: () => void;
  onUpdated: (result: UpdateDecisionProgressResult) => void;
}

const DECISION_STATUS_OPTIONS: { value: DecisionStatus; label: string }[] = [
  { value: 'not_started',          label: 'شروع‌نشده' },
  { value: 'planned',              label: 'برنامه‌ریزی‌شده' },
  { value: 'in_progress',          label: 'در حال انجام' },
  { value: 'waiting_coordination', label: 'منتظر هماهنگی' },
  { value: 'waiting_approval',     label: 'منتظر تأیید' },
  { value: 'completed',            label: 'تکمیل‌شده' },
  { value: 'stopped',              label: 'متوقف‌شده' },
];

const RPC_ERROR_MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: 'احراز هویت نشده‌اید. لطفاً دوباره وارد شوید.',
  INVALID_DECISION_STATUS: 'وضعیت انتخاب‌شده نامعتبر است.',
  INVALID_PROGRESS_PERCENT: 'درصد پیشرفت باید بین ۰ تا ۱۰۰ باشد.',
  DECISION_NOT_FOUND: 'مصوبه یافت نشد.',
  MINUTE_NOT_PUBLISHED: 'صورت‌جلسه در وضعیت قابل به‌روزرسانی نیست.',
  DECISION_NO_PERMISSION: 'شما اجازه به‌روزرسانی این مصوبه را ندارید.',
  COMPLETION_REQUIRES_FULL_PROGRESS: 'تکمیل فقط با درصد پیشرفت ۱۰۰ ممکن است.',
  PAYLOAD_INVALID: 'اطلاعات ارسالی نامعتبر است.',
  INTERNAL_ERROR: 'خطای داخلی سرور رخ داد. لطفاً دوباره تلاش کنید.',
};

export function DecisionProgressModal({ decision, history, canUpdate, onClose, onUpdated }: DecisionProgressModalProps) {
  const [status, setStatus] = useState<DecisionStatus>(decision.status);
  const [progress, setProgress] = useState<number>(decision.progress_percent);
  const [updateText, setUpdateText] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleProgressChange = (v: number) => {
    setProgress(v);
    if (v === 100) setStatus('completed');
  };

  const handleSubmit = async () => {
    if (submitting || !canUpdate) return;
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('update_decision_progress', {
        p_decision_id: decision.id,
        p_status: status,
        p_progress_percent: progress,
        p_update_text: updateText || null,
      });
      if (rpcError) {
        setError('به‌روزرسانی پیشرفت ناموفق بود. لطفاً دوباره تلاش کنید.');
        return;
      }
      const result = data as UpdateDecisionProgressResult;
      if (result && result.success === false) {
        const code = result.error_code || 'INTERNAL_ERROR';
        setError(RPC_ERROR_MESSAGES[code] || 'به‌روزرسانی پیشرفت ناموفق بود.');
        return;
      }
      if (result && result.success === true) {
        onUpdated(result);
        return;
      }
      setError('پاسخ نامعتبر از سرور دریافت شد.');
    } catch {
      setError('خطای غیرمنتظره رخ داد. لطفاً دوباره تلاش کنید.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">به‌روزرسانی پیشرفت مصوبه</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" aria-label="بستن">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{decision.title}</p>
            {decision.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{decision.description}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">وضعیت</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value as DecisionStatus)}
                disabled={!canUpdate}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-60"
              >
                {DECISION_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">درصد پیشرفت: {progress}٪</label>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={progress}
                onChange={e => handleProgressChange(Number(e.target.value))}
                disabled={!canUpdate}
                className="w-full accent-blue-600 disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">گزارش پیشرفت</label>
            <textarea
              rows={3}
              value={updateText}
              onChange={e => setUpdateText(e.target.value)}
              disabled={!canUpdate}
              placeholder="توضیحات این به‌روزرسانی..."
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white resize-none disabled:opacity-60"
            />
          </div>

          {/* History */}
          {history.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 mb-2">تاریخچه به‌روزرسانی‌ها</p>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {history.map(h => (
                  <div key={h.id} className="bg-gray-50 dark:bg-gray-700/30 rounded-lg p-2.5 text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-700 dark:text-gray-300">{h.created_by_name || 'کاربر'}</span>
                      <span className="text-gray-400">{new Date(h.created_at).toLocaleDateString('fa-IR')}</span>
                    </div>
                    <div className="text-gray-500 dark:text-gray-400">
                      {h.previous_status ?? '—'} ← {h.new_status} | {h.previous_progress_percent ?? 0}٪ → {h.new_progress_percent}٪
                    </div>
                    {h.update_text && <p className="text-gray-600 dark:text-gray-300 mt-1">{h.update_text}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">{error}</div>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={handleSubmit}
            disabled={submitting || !canUpdate}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {submitting ? 'در حال ذخیره...' : 'ثبت به‌روزرسانی'}
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MinutesStatusBadge ──────────────────────────────────────────────────────

const MINUTES_STATUS_CONFIG: Record<MinutesStatus, { label: string; classes: string }> = {
  draft:             { label: 'پیش‌نویس',          classes: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  pending_approval:  { label: 'در انتظار تأیید',    classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  changes_requested: { label: 'درخواست اصلاح',      classes: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  approved:          { label: 'تأییدشده',            classes: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  published:         { label: 'منتشرشده',            classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
};

export function MinutesStatusBadge({ status }: { status: MinutesStatus }) {
  const cfg = MINUTES_STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── ConfidentialityBadge ────────────────────────────────────────────────────

const CONFIDENTIALITY_CONFIG: Record<ConfidentialityLevel, { label: string; classes: string }> = {
  public:         { label: 'عمومی',    classes: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' },
  organizational: { label: 'سازمانی', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  restricted:     { label: 'محدود',   classes: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  confidential:   { label: 'محرمانه', classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

export function ConfidentialityBadge({ level }: { level: ConfidentialityLevel }) {
  const cfg = CONFIDENTIALITY_CONFIG[level];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── DecisionStatusBadge ─────────────────────────────────────────────────────

const DECISION_STATUS_CONFIG: Record<DecisionStatus, { label: string; classes: string }> = {
  not_started:         { label: 'شروع‌نشده',         classes: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
  planned:             { label: 'برنامه‌ریزی‌شده',   classes: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  in_progress:         { label: 'در حال انجام',       classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  waiting_coordination:{ label: 'منتظر هماهنگی',      classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  waiting_approval:    { label: 'منتظر تأیید',        classes: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  completed:           { label: 'تکمیل‌شده',          classes: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  stopped:             { label: 'متوقف‌شده',           classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

export function DecisionStatusBadge({ status }: { status: DecisionStatus }) {
  const cfg = DECISION_STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── DecisionPriorityBadge ───────────────────────────────────────────────────

const PRIORITY_CONFIG: Record<DecisionPriority, { label: string; classes: string }> = {
  low:       { label: 'کم',    classes: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
  normal:    { label: 'عادی', classes: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  important: { label: 'مهم',  classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  urgent:    { label: 'فوری', classes: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

export function DecisionPriorityBadge({ priority }: { priority: DecisionPriority }) {
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── ApprovalStatusBadge ─────────────────────────────────────────────────────

const APPROVAL_STATUS_CONFIG: Record<ApprovalStatus, { label: string; classes: string }> = {
  pending:           { label: 'در انتظار',      classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  approved:          { label: 'تأییدشده',        classes: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  changes_requested: { label: 'درخواست اصلاح',  classes: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  invalidated:       { label: 'باطل‌شده',         classes: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' },
};

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const cfg = APPROVAL_STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── ApprovalModeBadge ────────────────────────────────────────────────────────

const APPROVAL_MODE_CONFIG: Record<ApprovalMode, { label: string; classes: string }> = {
  system:    { label: 'تأیید سیستمی',  classes: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  in_person: { label: 'تأیید حضوری',   classes: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400' },
};

export function ApprovalModeBadge({ mode }: { mode: ApprovalMode | null | undefined }) {
  if (!mode) return null;
  const cfg = APPROVAL_MODE_CONFIG[mode];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.classes}`}>
      {cfg.label}
    </span>
  );
}

// ── ProgressIndicator ───────────────────────────────────────────────────────

export function ProgressIndicator({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  const color = clamped >= 80 ? 'bg-green-500' : clamped >= 40 ? 'bg-blue-500' : 'bg-amber-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2 min-w-[4rem]">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-left">{clamped}٪</span>
    </div>
  );
}

// ── EmptyState ──────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-center" dir="rtl">
      {icon && (
        <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-400">
          {icon}
        </div>
      )}
      <div className="space-y-1">
        <p className="text-base font-semibold text-gray-700 dark:text-gray-300">{title}</p>
        {description && <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs mx-auto">{description}</p>}
      </div>
      {action}
    </div>
  );
}

// ── PageHeader ──────────────────────────────────────────────────────────────

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{title}</h1>
        {description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}

// ── StatCard ────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  colorClass: string;
  onClick?: () => void;
}

export function StatCard({ label, value, icon, colorClass, onClick }: StatCardProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-right bg-white dark:bg-gray-800 rounded-2xl p-5 shadow-sm border border-gray-100 dark:border-gray-700 hover:shadow-md transition-shadow ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
      dir="rtl"
      type="button"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">{label}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white">{value}</p>
        </div>
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colorClass}`}>
          {icon}
        </div>
      </div>
    </button>
  );
}

// ── LoadingSkeleton ─────────────────────────────────────────────────────────

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 bg-gray-200 dark:bg-gray-700 rounded-xl" />
      ))}
    </div>
  );
}

// ── ConfirmActionDialog ─────────────────────────────────────────────────────

interface ConfirmActionDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}

export function ConfirmActionDialog({
  title,
  message,
  confirmLabel = 'تأیید',
  cancelLabel = 'انصراف',
  onConfirm,
  onCancel,
  danger = false,
}: ConfirmActionDialogProps) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="p-6">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">{title}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">{message}</p>
        </div>
        <div className="flex gap-3 px-6 pb-6">
          <button
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors ${danger ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'}`}
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
