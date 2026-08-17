import { useState } from 'react';
import { Loader as Loader2, X, ShieldCheck } from 'lucide-react';
import { setLifecycleState } from '../services/accountLifecycleService';
import { SecurityStepUpDialog } from '../../security-settings/components/SecurityStepUpDialog';
import { STATUS_LABELS, ACTION_LABELS } from '../types/accountLifecycle';
import type { LifecycleUser, LifecycleAction } from '../types/accountLifecycle';
import toast from 'react-hot-toast';

interface Props {
  user: LifecycleUser;
  action: LifecycleAction;
  onClose: () => void;
  onComplete: () => void;
}

export function AccountLifecycleActionDialog({ user, action, onClose, onComplete }: Props) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpDone, setStepUpDone] = useState(false);

  const newStatus: Record<LifecycleAction, string> = {
    APPROVE: 'ACTIVE',
    REJECT: 'REJECTED',
    REOPEN: 'PENDING_ADMIN_APPROVAL',
    SUSPEND: 'SUSPENDED',
    REACTIVATE: 'ACTIVE',
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (reason.trim().length < 10) {
      toast.error('دلیل تغییر باید حداقل ۱۰ کاراکتر باشد');
      return;
    }
    if (!confirmed) {
      toast.error('لطفاً تأیید تغییر را علامت بزنید');
      return;
    }
    if (!stepUpDone) {
      setStepUpOpen(true);
      return;
    }

    setSubmitting(true);
    try {
      const result = await setLifecycleState(user.user_id, action, user.account_lifecycle_version, reason.trim());
      if (!result.ok) {
        if (result.error === 'VERSION_CONFLICT') {
          toast.error('اطلاعات توسط کاربر دیگری تغییر کرده است. لیست بارگذاری مجدد شد.');
          onComplete();
        } else if (result.error === 'STEPUP_REQUIRED') {
          setStepUpDone(false);
          setStepUpOpen(true);
        } else {
          toast.error('خطا در انجام عملیات');
        }
        return;
      }
      toast.success(`${ACTION_LABELS[action]} با موفقیت انجام شد`);
      onComplete();
    } catch {
      toast.error('خطا در انجام عملیات');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStepUpComplete = () => {
    setStepUpOpen(false);
    setStepUpDone(true);
    toast.success('تأیید هویت دومرحله‌ای موفق بود');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white">
            {ACTION_LABELS[action]} حساب
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* User info */}
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 space-y-1">
            <div className="text-sm font-medium text-gray-800 dark:text-white">{user.full_name}</div>
            <div className="text-xs text-gray-500">@{user.username}</div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs text-gray-500">وضعیت فعلی:</span>
              <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                {STATUS_LABELS[user.account_status] ?? user.account_status}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">وضعیت جدید:</span>
              <span className="text-xs font-medium text-teal-600 dark:text-teal-400">
                {STATUS_LABELS[newStatus[action]] ?? newStatus[action]}
              </span>
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              دلیل تغییر <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="حداقل ۱۰ کاراکتر..."
              className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-teal-500 dark:bg-gray-700 dark:text-white text-sm min-h-[80px]"
              rows={3}
            />
          </div>

          {/* Confirmation checkbox */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="w-4 h-4 rounded text-teal-500"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              تأیید می‌کنم که این تغییر را با آگاهی کامل انجام می‌دهم
            </span>
          </label>

          {/* Step-up status */}
          {stepUpDone && (
            <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
              <ShieldCheck className="w-4 h-4" />
              تأیید هویت دومرحله‌ای انجام شد
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-2.5 rounded-xl font-medium text-sm transition disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {stepUpDone ? 'انجام عملیات' : 'تأیید و ادامه'}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-sm text-gray-500 border border-gray-200 dark:border-gray-600 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              انصراف
            </button>
          </div>
        </div>
      </div>

      {/* Step-up Dialog */}
      {stepUpOpen && (
        <SecurityStepUpDialog
          open={true}
          purpose="account_security_change"
          title="تأیید هویت دومرحله‌ای"
          description="برای تغییر وضعیت حساب، تأیید هویت دومرحله‌ای لازم است."
          confirmLabel="تأیید"
          onClose={() => setStepUpOpen(false)}
          onSuccess={handleStepUpComplete}
        />
      )}
    </div>
  );
}
