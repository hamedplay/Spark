import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, LoaderCircle, LogOut, ShieldCheck, ShieldX } from 'lucide-react';
import OtpCodeInput, { type OtpCodeInputStatus } from './OtpCodeInput';
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

function AuthBackdrop({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="spark-reference-login flex min-h-screen items-center justify-center overflow-y-auto px-4 py-6"
      dir="rtl"
      style={{ position: 'fixed', inset: 0, zIndex: 2147483000 }}
    >
      <div className="spark-reference-matrix" aria-hidden="true" />
      <div className="spark-reference-grid" aria-hidden="true" />
      <div className="spark-reference-aurora spark-reference-aurora-a" aria-hidden="true" />
      <div className="spark-reference-aurora spark-reference-aurora-b" aria-hidden="true" />
      {children}
    </div>
  );
}

function SparkBrand({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="spark-reference-brand">
      <div className="spark-reference-brand-mark">
        <img src="/logo_spark.png" alt="Spark" />
        <span className="spark-reference-brand-halo" aria-hidden="true" />
      </div>
      <div className="spark-reference-wordmark" dir="ltr">Spark</div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  );
}

export function TotpChallengeGate({ onCompleted, onSignOut }: TotpChallengeGateProps) {
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [selectedFactorId, setSelectedFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [loadingFactors, setLoadingFactors] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const allFactors = await listCurrentUserTotpFactors();
        if (cancelled) return;
        const verifiedFactors = allFactors.filter((factor) => factor.status === 'verified');
        setFactors(verifiedFactors);
        if (verifiedFactors.length === 1) {
          setSelectedFactorId(verifiedFactors[0].id);
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
      setVerified(true);
      await new Promise(resolve => window.setTimeout(resolve, 480));
      setCode('');
      await onCompleted();
    } catch {
      setVerified(false);
      setError('کد واردشده معتبر نیست.');
    } finally {
      setBusy(false);
    }
  }, [code, selectedFactorId, onCompleted]);

  const otpStatus: OtpCodeInputStatus = verified
    ? 'success'
    : busy
      ? 'checking'
      : error
        ? 'error'
        : 'idle';

  if (loadingFactors) {
    return (
      <AuthBackdrop>
        <section className="spark-reference-form-panel w-full max-w-[470px]" aria-label="در حال بررسی احراز هویت">
          <div className="spark-reference-form-inner">
            <SparkBrand title="احراز هویت دو مرحله‌ای" subtitle="در حال بررسی روش احراز هویت شما" />
            <div className="spark-reference-form flex min-h-32 items-center justify-center">
              <LoaderCircle className="spark-spin h-8 w-8 text-emerald-300" />
            </div>
            <div className="spark-reference-secure-note"><ShieldCheck /><span>ورود امن به سامانه اسپارک</span></div>
          </div>
        </section>
      </AuthBackdrop>
    );
  }

  if (factors.length === 0) {
    return (
      <AuthBackdrop>
        <section className="spark-reference-form-panel w-full max-w-[470px]" aria-label="خطای احراز هویت دو مرحله‌ای">
          <div className="spark-reference-form-inner">
            <SparkBrand title="احراز هویت دو مرحله‌ای" subtitle="امکان ادامه ورود با TOTP وجود ندارد" />
            <div className="spark-reference-form">
              <div className="spark-otp-code" data-state="error" data-complete="false">
                <div className="spark-otp-code__heading">
                  <span className="spark-otp-code__icon" aria-hidden="true"><ShieldX /></span>
                  <span>
                    <strong>برنامه احراز هویت پیدا نشد</strong>
                    <small>برای این حساب عامل TOTP تأییدشده‌ای در دسترس نیست.</small>
                  </span>
                </div>
                <div className="spark-otp-code__status" role="alert">برای ادامه، دوباره وارد حساب شوید یا با مدیر سامانه تماس بگیرید.</div>
              </div>
              <button type="button" className="spark-reference-submit" onClick={onSignOut}>
                <span>خروج از حساب</span><LogOut />
              </button>
            </div>
            <div className="spark-reference-secure-note"><ShieldCheck /><span>ورود امن به سامانه اسپارک</span></div>
          </div>
        </section>
      </AuthBackdrop>
    );
  }

  return (
    <AuthBackdrop>
      <section className="spark-reference-form-panel w-full max-w-[470px]" aria-label="تأیید احراز هویت دو مرحله‌ای">
        <div className="spark-reference-form-inner">
          <SparkBrand
            title="تأیید ورود"
            subtitle="برای تکمیل ورود، کد برنامه احراز هویت را تأیید کنید"
          />

          <div className="spark-reference-form">
            {factors.length > 1 && (
              <label className="spark-reference-field">
                <span>برنامه احراز هویت</span>
                <select
                  value={selectedFactorId ?? ''}
                  onChange={event => {
                    setSelectedFactorId(event.target.value);
                    setCode('');
                    setError(null);
                    setVerified(false);
                  }}
                  disabled={busy || verified}
                  className="spark-reference-input"
                >
                  {factors.map(factor => (
                    <option key={factor.id} value={factor.id}>
                      برنامه احراز هویت — {new Date(factor.createdAt).toLocaleDateString('fa-IR')}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <OtpCodeInput
              value={code}
              onChange={nextValue => {
                setCode(nextValue);
                if (error) setError(null);
                if (verified) setVerified(false);
              }}
              length={OTP_LENGTH}
              label="کد تأیید"
              hint="کد ۶ رقمی برنامه احراز هویت را وارد کنید"
              status={otpStatus}
              errorMessage={error ?? undefined}
              disabled={busy || verified}
              autoFocusKey={selectedFactorId ?? 'totp'}
            />

            <button
              type="button"
              className="spark-reference-submit"
              disabled={busy || verified || code.length !== OTP_LENGTH || !selectedFactorId}
              onClick={() => void handleVerify()}
            >
              {busy ? <LoaderCircle className="spark-spin" /> : <><span>{verified ? 'تأیید شد' : 'تأیید و ورود'}</span><ArrowLeft /></>}
            </button>

            <button
              type="button"
              className="spark-reference-link spark-reference-center-link"
              disabled={busy || verified}
              onClick={onSignOut}
            >
              خروج از حساب
            </button>
          </div>

          <div className="spark-reference-secure-note"><ShieldCheck /><span>ورود امن به سامانه اسپارک</span></div>
        </div>
      </section>
    </AuthBackdrop>
  );
}
