import { useState, useEffect, useCallback, useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { ShieldCheck, Loader as Loader2, Check, LogOut } from 'lucide-react';
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

const OTP_LENGTH = 6;

export function TotpChallengeGate({ onCompleted, onSignOut }: TotpChallengeGateProps) {
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingFactors, setLoadingFactors] = useState(true);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

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

  const updateDigit = (index: number, value: string) => {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = code.padEnd(OTP_LENGTH, ' ').split('');
    next[index] = digit || ' ';
    setCode(next.join('').replace(/ /g, ''));
    setError(null);

    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Backspace') return;
    const digit = code[index] ?? '';
    if (!digit && index > 0) {
      event.preventDefault();
      const next = code.split('');
      next.splice(index - 1, 1);
      setCode(next.join(''));
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;
    event.preventDefault();
    setCode(pasted);
    setError(null);
    inputRefs.current[Math.min(pasted.length, OTP_LENGTH) - 1]?.focus();
  };

  const shell = (children: React.ReactNode) => (
    <div className="spark-reference-login fixed inset-0 z-[2147483000] flex min-h-screen items-center justify-center overflow-y-auto px-4 py-8" dir="rtl">
      <div className="spark-reference-matrix" aria-hidden="true" />
      <div className="spark-reference-grid" aria-hidden="true" />
      <div className="spark-reference-aurora spark-reference-aurora-a" aria-hidden="true" />
      <div className="spark-reference-aurora spark-reference-aurora-b" aria-hidden="true" />
      {children}
    </div>
  );

  if (loadingFactors) {
    return shell(
      <div className="flex w-full max-w-sm items-center justify-center rounded-[22px] border border-emerald-300/20 bg-[#06191a]/90 p-10 shadow-2xl backdrop-blur-xl">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-300" />
      </div>,
    );
  }

  if (factors.length === 0) {
    return shell(
      <div className="w-full max-w-sm rounded-[22px] border border-emerald-300/20 bg-[#06191a]/90 p-7 text-center shadow-2xl backdrop-blur-xl">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl border border-amber-300/25 bg-amber-300/10 text-amber-300">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-bold text-white">برنامه احراز هویت پیدا نشد</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">برنامه احراز هویت برای این حساب پیدا نشد.</p>
        <button
          onClick={onSignOut}
          className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/10"
        >
          <LogOut className="h-4 w-4" />
          خروج از حساب
        </button>
      </div>,
    );
  }

  return shell(
    <div className="w-full max-w-[390px] rounded-[22px] border border-emerald-300/25 bg-[linear-gradient(155deg,rgba(8,31,31,.96),rgba(2,18,20,.98))] px-4 py-5 shadow-[0_24px_80px_rgba(0,0,0,.45),inset_0_1px_0_rgba(255,255,255,.06)] backdrop-blur-2xl sm:px-5">
      <div className="flex items-start justify-center gap-3 text-right">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-300 shadow-[0_0_22px_rgba(35,232,196,.08)]">
          <ShieldCheck className="h-5 w-5" strokeWidth={2.1} />
        </div>
        <div className="pt-0.5">
          <h1 className="text-base font-extrabold text-white">کد تأیید</h1>
          <p className="mt-1 text-[11px] text-slate-400">کد ۶ رقمی برنامه احراز هویت را وارد کنید</p>
        </div>
      </div>

      {factors.length > 1 && (
        <div className="mt-5">
          <label className="mb-2 block text-xs text-slate-400">انتخاب برنامه احراز هویت</label>
          <select
            value={selectedFactorId ?? ''}
            onChange={(e) => setSelectedFactorId(e.target.value)}
            className="h-11 w-full rounded-xl border border-emerald-300/15 bg-[#071b1c] px-3 text-sm text-slate-100 outline-none transition focus:border-emerald-300/45 focus:ring-2 focus:ring-emerald-300/10"
          >
            {factors.map((f) => (
              <option key={f.id} value={f.id}>
                برنامه احراز هویت — {new Date(f.createdAt).toLocaleDateString('fa-IR')}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-5 flex justify-center gap-2" dir="ltr">
        {Array.from({ length: OTP_LENGTH }).map((_, index) => (
          <input
            key={index}
            ref={(node) => { inputRefs.current[index] = node; }}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            value={code[index] ?? ''}
            onChange={(event) => updateDigit(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={handlePaste}
            onFocus={(event) => event.currentTarget.select()}
            aria-label={`رقم ${index + 1} کد تأیید`}
            disabled={busy}
            className="h-14 min-w-0 flex-1 rounded-xl border border-emerald-300/15 bg-[#071b1c]/95 text-center font-mono text-xl font-bold text-white caret-emerald-300 outline-none transition placeholder:text-slate-600 hover:border-emerald-300/25 focus:border-emerald-300/50 focus:bg-[#0a2324] focus:ring-2 focus:ring-emerald-300/10 disabled:cursor-not-allowed disabled:opacity-60"
          />
        ))}
      </div>

      {error && (
        <p className="mt-3 text-center text-xs font-medium text-rose-400">{error}</p>
      )}

      <p className="mt-4 text-center text-[11px] font-semibold text-slate-400">کد کاملاً امن است و فقط برای تأیید ورود استفاده می‌شود</p>

      <div className="mt-5 grid grid-cols-[1fr_auto] gap-2.5">
        <button
          onClick={handleVerify}
          disabled={busy || code.length !== OTP_LENGTH || !selectedFactorId}
          className="flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-200/25 bg-emerald-300/15 px-4 text-sm font-bold text-emerald-100 transition hover:bg-emerald-300/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          تأیید
        </button>
        <button
          onClick={onSignOut}
          disabled={busy}
          className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          خروج
        </button>
      </div>
    </div>,
  );
}
