import { useState, useEffect, useCallback } from 'react';
import { KeyRound, Loader as Loader2, Check } from 'lucide-react';
import {
  listCurrentUserTotpFactors,
  verifyTotpFactor,
  validateTotpCode,
  type TotpFactor,
} from '../services/mfaOperations';

interface TotpChallengeGateProps {
  onCompleted: () => Promise<void>;
  onSignOut: () => void;
}

export function TotpChallengeGate({ onCompleted, onSignOut }: TotpChallengeGateProps) {
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingFactors, setLoadingFactors] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const allFactors = await listCurrentUserTotpFactors();
        if (cancelled) return;
        const verified = allFactors.filter((f) => f.status === 'verified');
        setFactors(verified);
        if (verified.length === 1) {
          setSelectedFactorId(verified[0].id);
        }
      } catch {
        if (!cancelled) {
          setError('برنامه احراز هویت برای این حساب پیدا نشد.');
        }
      } finally {
        if (!cancelled) setLoadingFactors(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleVerify = useCallback(async () => {
    const validCode = validateTotpCode(code);
    if (!validCode) {
      setError('کد واردشده معتبر نیست.');
      return;
    }

    if (!selectedFactorId) {
      setError('برنامه احراز هویت برای این حساب پیدا نشد.');
      return;
    }

    setError(null);
    setBusy(true);
    try {
      await verifyTotpFactor(selectedFactorId, validCode);
      setCode('');
      await onCompleted();
    } catch {
      setError('کد واردشده معتبر نیست.');
    } finally {
      setBusy(false);
    }
  }, [code, selectedFactorId, onCompleted]);

  if (loadingFactors) {
    return (
      <div className="w-full max-w-md mx-auto flex flex-col items-center gap-6 px-6" dir="rtl">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (factors.length === 0) {
    return (
      <div className="w-full max-w-md mx-auto flex flex-col items-center gap-6 px-6" dir="rtl">
        <div className="w-20 h-20 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <KeyRound className="w-10 h-10 text-amber-500" />
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-xl font-bold text-gray-800 dark:text-white">
            برنامه احراز هویت پیدا نشد
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            برنامه احراز هویت برای این حساب پیدا نشد.
          </p>
        </div>
        <button
          onClick={onSignOut}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition-colors w-full"
        >
          خروج از حساب
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md mx-auto flex flex-col items-center gap-6 px-6" dir="rtl">
      <div className="w-20 h-20 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
        <KeyRound className="w-10 h-10 text-blue-500" />
      </div>
      <div className="text-center space-y-2">
        <h1 className="text-xl font-bold text-gray-800 dark:text-white">
          تأیید احراز هویت دو مرحله‌ای
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          کد ۶ رقمی از برنامه احراز هویت خود را وارد کنید.
        </p>
      </div>

      {factors.length > 1 && (
        <div className="w-full">
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">
            انتخاب برنامه احراز هویت
          </label>
          <select
            value={selectedFactorId ?? ''}
            onChange={(e) => setSelectedFactorId(e.target.value)}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {factors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.friendlyName ?? 'بدون نام'} — {new Date(f.createdAt).toLocaleDateString('fa-IR')}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="w-full">
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="کد ۶ رقمی"
          className="w-full text-center text-2xl tracking-[0.5em] font-mono px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          dir="ltr"
        />
      </div>

      {error && (
        <p className="text-sm text-red-500 text-center">{error}</p>
      )}

      <div className="flex gap-3 w-full">
        <button
          onClick={handleVerify}
          disabled={busy || code.length !== 6 || !selectedFactorId}
          className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          تأیید
        </button>
        <button
          onClick={onSignOut}
          className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition-colors"
        >
          خروج از حساب
        </button>
      </div>
    </div>
  );
}
