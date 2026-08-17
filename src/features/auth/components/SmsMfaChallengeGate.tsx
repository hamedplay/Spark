import { useEffect, useState } from 'react';
import { LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { createCustomMfaChallenge, resendCustomMfaChallenge, verifyCustomMfaChallenge } from '../services/customMfaService';

export function SmsMfaChallengeGate({ onCompleted, onSignOut }: { onCompleted: () => Promise<void>; onSignOut: () => void }) {
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const result = await createCustomMfaChallenge('sms');
      if (!result.ok || !result.challenge_id) throw new Error('SMS_SEND_FAILED');
      setChallengeId(result.challenge_id);
    } catch { setError('ارسال کد تأیید ممکن نشد.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void create(); }, []);

  const verify = async () => {
    if (!challengeId || !/^\d{6}$/.test(code)) return;
    setBusy(true); setError(null);
    try {
      const result = await verifyCustomMfaChallenge(challengeId, code);
      if (!result.ok) throw new Error('INVALID_CODE');
      await onCompleted();
    } catch { setError('کد واردشده معتبر نیست یا منقضی شده است.'); }
    finally { setBusy(false); }
  };
  const resend = async () => {
    if (!challengeId) return void create();
    setBusy(true); setError(null);
    try { const result = await resendCustomMfaChallenge(challengeId); if (!result.ok) throw new Error('RESEND_FAILED'); }
    catch { setError('ارسال مجدد کد ممکن نشد.'); }
    finally { setBusy(false); }
  };
  return <div className="max-w-md w-full min-w-0 rounded-2xl bg-white dark:bg-gray-800 p-4 sm:p-6 shadow-xl text-right" dir="rtl">
    <div className="flex items-center justify-between gap-3 mb-5"><ShieldCheck className="w-7 h-7 flex-shrink-0 text-blue-600"/><button type="button" onClick={onSignOut} className="text-sm text-gray-500 flex gap-1 items-center"><LogOut className="w-4 h-4"/>خروج</button></div>
    <h1 className="text-xl font-bold">تأیید پیامکی</h1><p className="mt-2 text-sm text-gray-500">کد شش‌رقمی ارسال‌شده به شماره تأییدشده شما را وارد کنید.</p>
    <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr" placeholder="••••••" className="mt-5 w-full min-w-0 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 text-center text-xl tracking-[0.45em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
    {error && <p className="mt-3 text-sm text-red-600 break-words">{error}</p>}
    <button type="button" disabled={busy || code.length !== 6} onClick={() => void verify()} className="mt-4 w-full rounded-xl bg-blue-600 py-3 text-white disabled:opacity-50">{busy ? 'در حال بررسی…' : 'تأیید و ورود'}</button>
    <button type="button" disabled={busy} onClick={() => void resend()} className="mt-3 w-full text-sm text-blue-600 disabled:opacity-50 flex justify-center gap-1"><RefreshCw className="w-4 h-4"/>ارسال مجدد کد</button>
  </div>;
}
