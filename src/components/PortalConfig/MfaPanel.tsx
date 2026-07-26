import { useState, useEffect } from 'react';
import { ShieldCheck, X, KeyRound } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

export function MfaPanel() {
  const [step, setStep] = useState<'idle' | 'enrolling' | 'verifying' | 'enrolled'>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [factors, setFactors] = useState<any[]>([]);

  const loadFactors = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(data?.totp || []);
    if ((data?.totp || []).some((f: any) => f.status === 'verified')) setStep('enrolled');
  };

  useEffect(() => { loadFactors(); }, []);

  const handleEnroll = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Authenticator App' });
      if (error || !data) { toast.error('خطا در فعال‌سازی MFA: ' + (error?.message || '')); return; }
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
      setSecret(data.totp.secret);
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: data.id });
      if (chErr || !ch) { toast.error('خطا در ایجاد چالش: ' + (chErr?.message || '')); return; }
      setChallengeId(ch.id);
      setStep('verifying');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!factorId || !challengeId) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
      if (error) { toast.error('کد اشتباه است: ' + error.message); return; }
      toast.success('احراز هویت دو مرحله‌ای با موفقیت فعال شد');
      setCode('');
      await loadFactors();
    } finally {
      setLoading(false);
    }
  };

  const handleUnenroll = async (fId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: fId });
      if (error) { toast.error('خطا در غیرفعال‌سازی: ' + error.message); return; }
      toast.success('احراز هویت دو مرحله‌ای غیرفعال شد');
      setStep('idle');
      setQrCode(null);
      setSecret(null);
      await loadFactors();
    } finally {
      setLoading(false);
    }
  };

  if (step === 'enrolled') {
    const verifiedFactor = factors.find((f: any) => f.status === 'verified');
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-700/40">
          <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-green-700 dark:text-green-300">احراز هویت دو مرحله‌ای فعال است</p>
            <p className="text-xs text-green-600/80 dark:text-green-400/70 mt-0.5">حساب شما با برنامه احراز هویت محافظت می‌شود</p>
          </div>
        </div>
        {verifiedFactor && (
          <button onClick={() => handleUnenroll(verifiedFactor.id)} disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 rounded-xl text-sm font-medium transition-colors border border-red-200 dark:border-red-700/40">
            <X className="w-4 h-4" />
            غیرفعال کردن MFA
          </button>
        )}
      </div>
    );
  }

  if (step === 'verifying') {
    return (
      <div className="flex flex-col gap-4">
        {qrCode && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-gray-600 dark:text-gray-400 text-center">کد QR را با برنامه احراز هویت (مثل Google Authenticator) اسکن کنید:</p>
            <img src={qrCode} alt="QR Code" className="w-40 h-40 rounded-xl border border-gray-200 dark:border-gray-600 bg-white p-2" />
            {secret && (
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center font-mono bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded-lg break-all">
                {secret}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">کد ۶ رقمی از برنامه:</label>
          <input type="text" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors text-center tracking-widest font-mono" />
        </div>
        <div className="flex gap-2">
          <button onClick={handleVerify} disabled={loading || code.length !== 6}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
            <ShieldCheck className="w-4 h-4" /> تایید و فعال‌سازی
          </button>
          <button onClick={() => { setStep('idle'); setQrCode(null); setSecret(null); setCode(''); }}
            className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm transition-colors">
            انصراف
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        احراز هویت دو مرحله‌ای (MFA) لایه امنیتی اضافه‌ای به حساب شما اضافه می‌کند. برای ورود، علاوه بر رمز عبور، به یک کد زمانی از برنامه احراز هویت نیاز دارید.
      </p>
      <button onClick={handleEnroll} disabled={loading}
        className="flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
        <KeyRound className="w-4 h-4" />
        فعال‌سازی احراز هویت دو مرحله‌ای
      </button>
    </div>
  );
}
