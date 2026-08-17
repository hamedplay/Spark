import { KeyRound, Loader as Loader2, Check, X } from 'lucide-react';
import type { SecurityStepUpState } from '../hooks/useSecurityStepUp';

export interface SecurityStepUpModalProps {
  state: SecurityStepUpState;
  title?: string;
  description?: string;
  confirmLabel?: string;
  onSelectFactor: (id: string | null) => void;
  onCodeChange: (code: string) => void;
  onClose: () => void;
  onVerify: () => void;
}

export function SecurityStepUpModal({
  state,
  title = 'تأیید امنیتی',
  description,
  confirmLabel = 'تأیید و ادامه',
  onSelectFactor,
  onCodeChange,
  onClose,
  onVerify,
}: SecurityStepUpModalProps) {
  if (!state.open) return null;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-blue-500" />
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={state.busy}
            aria-disabled={state.busy}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 disabled:opacity-50 disabled:pointer-events-none"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {description && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
        )}

        {state.loadingFactors ? (
          <div className="flex justify-center py-8">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          </div>
        ) : state.factors.length === 0 ? (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl text-sm text-amber-700 dark:text-amber-300">
            برای این عملیات ابتدا TOTP را در پروفایل خود فعال کنید.
          </div>
        ) : (
          <>
            {state.factors.length > 1 && (
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
                  انتخاب دستگاه احراز هویت
                </label>
                <select
                  value={state.selectedFactorId ?? ''}
                  onChange={(e) => onSelectFactor(e.target.value || null)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">انتخاب کنید</option>
                  {state.factors.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.friendlyName ?? 'بدون نام'} — {new Date(f.createdAt).toLocaleDateString('fa-IR')}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={state.code}
                onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="کد ۶ رقمی"
                className="w-full text-center text-2xl tracking-[0.5em] font-mono px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                dir="ltr"
              />
            </div>

            {state.error && <p className="text-sm text-red-500 text-center">{state.error}</p>}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onVerify}
                disabled={state.busy || state.code.length !== 6 || !state.selectedFactorId}
                className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                {state.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {confirmLabel}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={state.busy}
                aria-disabled={state.busy}
                className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                انصراف
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
