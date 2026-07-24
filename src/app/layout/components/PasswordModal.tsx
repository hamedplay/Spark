import { useState } from 'react';
import { Key, X, Check } from 'lucide-react';

import { logAudit } from '../../../lib/audit';
import { updateCurrentUserPassword } from '../../../features/auth';

export interface PasswordModalProps {
  onClose: () => void;
}

export function PasswordModal({
  onClose,
}: PasswordModalProps) {
  const [pwForm, setPwForm] = useState({
    current: '',
    next: '',
    confirm: '',
  });
  const [pwLoading, setPwLoading] =
    useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const changePassword = async () => {
    setError('');
    if (!pwForm.current || !pwForm.next) {
      setError('تمام فیلدها الزامی است');
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      setError(
        'رمز عبور جدید و تکرار آن مطابقت ندارند'
      );
      return;
    }
    if (pwForm.next.length < 6) {
      setError('رمز عبور باید حداقل ۶ کاراکتر باشد');
      return;
    }
    setPwLoading(true);
    try {
      try {
        await updateCurrentUserPassword(
          pwForm.next
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : String(err);
        setError('خطا: ' + message);
        return;
      }
      logAudit({
        module: 'auth',
        action: 'password_changed',
        details: 'رمز عبور تغییر کرد',
        severity: 'warning',
      });
      setSuccess(true);
      setTimeout(onClose, 1500);
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      dir="rtl"
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
              <Key className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white">
              تغییر رمز عبور
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-600" />
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-200 font-medium">
                رمز عبور با موفقیت تغییر کرد
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  رمز عبور فعلی
                </label>
                <input
                  type="password"
                  value={pwForm.current}
                  onChange={(e) =>
                    setPwForm((f) => ({
                      ...f,
                      current: e.target.value,
                    }))
                  }
                  className="w-full text-sm px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  رمز عبور جدید
                </label>
                <input
                  type="password"
                  value={pwForm.next}
                  onChange={(e) =>
                    setPwForm((f) => ({
                      ...f,
                      next: e.target.value,
                    }))
                  }
                  className="w-full text-sm px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
                  placeholder="حداقل ۶ کاراکتر"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  تکرار رمز عبور جدید
                </label>
                <input
                  type="password"
                  value={pwForm.confirm}
                  onChange={(e) =>
                    setPwForm((f) => ({
                      ...f,
                      confirm: e.target.value,
                    }))
                  }
                  className="w-full text-sm px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
                  placeholder="••••••••"
                />
              </div>
              {error && (
                <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                  {error}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={changePassword}
                  disabled={pwLoading}
                  className="flex-1 py-2.5 bg-teal-500 hover:bg-teal-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
                >
                  {pwLoading
                    ? 'در حال ذخیره...'
                    : 'ذخیره'}
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
                >
                  انصراف
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
