import { useState } from 'react';
import { ShieldAlert, RefreshCw, LogOut, KeyRound } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ReasonCode } from '../features/auth/types/authSession';

interface RestrictedAccessPageProps {
  reasonCode: ReasonCode | null;
  nextStep: string | null;
  onRefresh: () => Promise<void>;
  onSignOut: () => void;
}

const REASON_MESSAGES: Record<string, { title: string; description: string }> = {
  PHONE_VERIFICATION_REQUIRED: {
    title: 'تأیید شماره موبایل لازم است',
    description: 'برای دسترسی کامل به سامانه، شماره موبایل خود را تأیید کنید.',
  },
  ADMIN_APPROVAL_REQUIRED: {
    title: 'حساب در انتظار تأیید مدیر',
    description: 'حساب کاربری شما در انتظار تأیید مدیر سامانه است. پس از تأیید، دسترسی کامل فعال خواهد شد.',
  },
  PROFILE_COMPLETION_REQUIRED: {
    title: 'تکمیل پروفایل لازم است',
    description: 'برای دسترسی کامل به سامانه، پروفایل خود را تکمیل کنید.',
  },
  MFA_ENROLLMENT_REQUIRED: {
    title: 'فعال‌سازی احراز هویت دو مرحله‌ای لازم است',
    description: 'برای امنیت حساب خود، احراز هویت دو مرحله‌ای را فعال کنید.',
  },
  MFA_CHALLENGE_REQUIRED: {
    title: 'تأیید احراز هویت دو مرحله‌ای',
    description: 'برای دسترسی کامل، کد تأیید احراز هویت دو مرحله‌ای را وارد کنید.',
  },
  ACCOUNT_REJECTED: {
    title: 'حساب رد شده است',
    description: 'درخواست حساب شما توسط مدیر سامانه رد شده است.',
  },
  ACCOUNT_SUSPENDED: {
    title: 'حساب تعلیق شده است',
    description: 'حساب کاربری شما تعلیق شده است. برای اطلاعات بیشتر با مدیر خود تماس بگیرید.',
  },
  ACCOUNT_LOCKED: {
    title: 'حساب قفل شده است',
    description: 'حساب کاربری شما به دلیل تلاش‌های ناموفق متعدد قفل شده است.',
  },
  SESSION_INVALID: {
    title: 'نشست نامعتبر',
    description: 'نشست شما نامعتبر است. لطفاً مجدداً وارد شوید.',
  },
  SESSION_EXPIRED: {
    title: 'نشست منقضی شده',
    description: 'نشست شما منقضی شده است. لطفاً مجدداً وارد شوید.',
  },
  SESSION_REQUIRED: {
    title: 'ورود لازم است',
    description: 'برای دسترسی به سامانه وارد شوید.',
  },
  PROFILE_MISSING: {
    title: 'پروفایل یافت نشد',
    description: 'پروفایل کاربری یافت نشد. لطفاً با مدیر سامانه تماس بگیرید.',
  },
  ACCOUNT_STATUS_INVALID: {
    title: 'وضعیت حساب نامعتبر',
    description: 'وضعیت حساب کاربری شما نامعتبر است. با مدیر سامانه تماس بگیرید.',
  },
};

export function RestrictedAccessPage({ reasonCode, nextStep, onRefresh, onSignOut }: RestrictedAccessPageProps) {
  const [refreshing, setRefreshing] = useState(false);

  const message = reasonCode ? REASON_MESSAGES[reasonCode] : null;
  const isSessionError = reasonCode === 'SESSION_INVALID' || reasonCode === 'SESSION_EXPIRED' || reasonCode === 'SESSION_REQUIRED';

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  const handleSignOut = async () => {
    if (isSessionError) {
      await supabase.auth.signOut();
    }
    onSignOut();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900" dir="rtl">
      <div className="flex flex-col items-center gap-6 text-center max-w-md px-6">
        <div className="w-20 h-20 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <ShieldAlert className="w-10 h-10 text-amber-500" />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-white">
            {message?.title ?? 'دسترسی محدود'}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
            {message?.description ?? 'دسترسی شما به سامانه محدود است.'}
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full">
          {!isSessionError && (
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              بررسی مجدد وضعیت
            </button>
          )}
          {nextStep === 'verify_mfa' && (
            <button
              onClick={() => window.location.href = '/auth/v1/mfa'}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-sm font-medium transition-colors"
            >
              <KeyRound className="w-4 h-4" />
              تأیید احراز هویت دو مرحله‌ای
            </button>
          )}
          <button
            onClick={handleSignOut}
            className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition-colors"
          >
            <LogOut className="w-4 h-4" />
            خروج از حساب
          </button>
        </div>
      </div>
    </div>
  );
}
