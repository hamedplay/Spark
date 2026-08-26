import { type ReactNode, useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  CalendarDays,
  CheckCircle2,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  UsersRound,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

const ONBOARDING_VERSION = 1;

type OnboardingStatus = 'pending' | 'completed' | 'skipped';

interface FirstRunOnboardingGateProps {
  userId: string;
  enabled: boolean;
  profileCompletionRequired: boolean;
  children: ReactNode;
}

interface OnboardingProfile {
  full_name: string | null;
  registration_source: string | null;
}

interface OnboardingPreference {
  onboarding_version: number | null;
  onboarding_status: OnboardingStatus | null;
}

export function FirstRunOnboardingGate({
  userId,
  enabled,
  profileCompletionRequired,
  children,
}: FirstRunOnboardingGateProps) {
  const [checking, setChecking] = useState(enabled);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [fullName, setFullName] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!enabled || !userId) {
        setChecking(false);
        setShowOnboarding(false);
        return;
      }

      setChecking(true);
      try {
        const [profileResult, preferenceResult] = await Promise.all([
          supabase
            .from('profiles')
            .select('full_name, registration_source')
            .eq('user_id', userId)
            .maybeSingle(),
          supabase
            .from('user_preferences')
            .select('onboarding_version, onboarding_status')
            .eq('user_id', userId)
            .maybeSingle(),
        ]);

        if (cancelled) return;

        if (profileResult.error) {
          // Onboarding is UX-only. Never block canonical auth access on a tour-state read failure.
          setShowOnboarding(false);
          return;
        }

        const profile = profileResult.data as OnboardingProfile | null;
        const preference = preferenceResult.data as OnboardingPreference | null;
        setFullName(profile?.full_name?.trim() ?? '');

        const isPublicRegistration = profile?.registration_source === 'public_phone_registration';
        const acknowledgedCurrentVersion =
          (preference?.onboarding_version ?? 0) >= ONBOARDING_VERSION &&
          (preference?.onboarding_status === 'completed' || preference?.onboarding_status === 'skipped');

        setShowOnboarding(isPublicRegistration && !acknowledgedCurrentVersion);
      } catch {
        if (!cancelled) setShowOnboarding(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled, userId]);

  const acknowledge = useCallback(async (status: Exclude<OnboardingStatus, 'pending'>) => {
    const now = new Date().toISOString();

    // Close immediately: failure to persist a UX preference must not trap the user.
    setShowOnboarding(false);

    const payload = {
      user_id: userId,
      onboarding_version: ONBOARDING_VERSION,
      onboarding_status: status,
      onboarding_completed_at: status === 'completed' ? now : null,
      onboarding_skipped_at: status === 'skipped' ? now : null,
      updated_at: now,
    };

    const { error } = await supabase
      .from('user_preferences')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) {
      toast.error('وضعیت راهنما ذخیره نشد؛ می‌توانید به کار با سامانه ادامه دهید.');
    }
  }, [userId]);

  if (!enabled || checking || !showOnboarding) return <>{children}</>;

  return (
    <WelcomeOnboarding
      fullName={fullName}
      profileCompletionRequired={profileCompletionRequired}
      onSkip={() => void acknowledge('skipped')}
      onComplete={() => void acknowledge('completed')}
    />
  );
}

interface WelcomeOnboardingProps {
  fullName: string;
  profileCompletionRequired: boolean;
  onSkip: () => void;
  onComplete: () => void;
}

function WelcomeOnboarding({
  fullName,
  profileCompletionRequired,
  onSkip,
  onComplete,
}: WelcomeOnboardingProps) {
  const [step, setStep] = useState(0);
  const stepsCount = 4;
  const firstName = fullName.split(/\s+/).filter(Boolean)[0] ?? '';

  const next = () => {
    if (step >= stepsCount - 1) {
      onComplete();
      return;
    }
    setStep((value) => Math.min(value + 1, stepsCount - 1));
  };

  const previous = () => setStep((value) => Math.max(value - 1, 0));

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-sky-50 dark:from-gray-950 dark:via-gray-900 dark:to-slate-900 p-4 md:p-8 flex items-center justify-center" dir="rtl">
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-white/80 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 px-5 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-teal-500 text-white shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-800 dark:text-white">شروع کار با اسپارک</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">راهنمای کوتاه برای اولین ورود</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onSkip}
            className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
            رد کردن راهنما
          </button>
        </div>

        <div className="grid min-h-[560px] grid-cols-1 lg:grid-cols-[250px_1fr]">
          <aside className="border-b border-gray-100 bg-gray-50/80 p-5 dark:border-gray-700 dark:bg-gray-900/40 lg:border-b-0 lg:border-l">
            <div className="grid grid-cols-4 gap-2 lg:grid-cols-1 lg:gap-3">
              <StepNav index={0} current={step} title="خوش آمدید" icon={<Sparkles className="h-4 w-4" />} />
              <StepNav index={1} current={step} title="پروفایل شما" icon={<UserRoundCheck className="h-4 w-4" />} />
              <StepNav index={2} current={step} title="کار روزانه" icon={<CalendarDays className="h-4 w-4" />} />
              <StepNav index={3} current={step} title="امنیت و اعلان‌ها" icon={<ShieldCheck className="h-4 w-4" />} />
            </div>

            <div className="mt-6 hidden rounded-2xl border border-teal-100 bg-teal-50 p-4 text-xs leading-6 text-teal-800 dark:border-teal-900 dark:bg-teal-950/30 dark:text-teal-300 lg:block">
              این راهنما فقط برای آشنایی با سامانه است و هیچ‌کدام از کنترل‌های امنیتی حساب را تغییر نمی‌دهد.
            </div>
          </aside>

          <main className="flex flex-col p-6 md:p-10">
            <div className="mb-8 flex gap-2" aria-label="پیشرفت راهنما">
              {Array.from({ length: stepsCount }).map((_, index) => (
                <div
                  key={index}
                  className={`h-1.5 flex-1 rounded-full transition-all ${index <= step ? 'bg-teal-500' : 'bg-gray-200 dark:bg-gray-700'}`}
                />
              ))}
            </div>

            <div className="flex-1">
              {step === 0 && <WelcomeStep firstName={firstName} />}
              {step === 1 && <ProfileStep required={profileCompletionRequired} />}
              {step === 2 && <WorkStep />}
              {step === 3 && <SecurityStep required={profileCompletionRequired} />}
            </div>

            <div className="mt-8 flex items-center justify-between gap-3 border-t border-gray-100 pt-5 dark:border-gray-700">
              <button
                type="button"
                onClick={previous}
                disabled={step === 0}
                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <ArrowRight className="h-4 w-4" />
                قبلی
              </button>

              <div className="text-xs text-gray-400 dark:text-gray-500">
                {step + 1} از {stepsCount}
              </div>

              <button
                type="button"
                onClick={next}
                className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-teal-600"
              >
                {step === stepsCount - 1
                  ? (profileCompletionRequired ? 'ادامه به تکمیل پروفایل' : 'ورود به اسپارک')
                  : 'ادامه'}
                {step === stepsCount - 1 ? <CheckCircle2 className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
              </button>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function StepNav({
  index,
  current,
  title,
  icon,
}: {
  index: number;
  current: number;
  title: string;
  icon: ReactNode;
}) {
  const active = index === current;
  const done = index < current;

  return (
    <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs transition lg:text-sm ${
      active
        ? 'bg-white font-semibold text-teal-700 shadow-sm dark:bg-gray-800 dark:text-teal-300'
        : done
          ? 'text-gray-700 dark:text-gray-300'
          : 'text-gray-400 dark:text-gray-500'
    }`}>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
        active || done ? 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300' : 'bg-gray-100 dark:bg-gray-800'
      }`}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : icon}
      </span>
      <span className="hidden lg:inline">{title}</span>
    </div>
  );
}

function WelcomeStep({ firstName }: { firstName: string }) {
  return (
    <div className="space-y-8">
      <div className="max-w-2xl">
        <span className="inline-flex rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">حساب شما آماده است ✓</span>
        <h1 className="mt-4 text-3xl font-bold leading-tight text-gray-900 dark:text-white md:text-4xl">
          {firstName ? `${firstName}، خوش اومدی به اسپارک 👋` : 'خوش اومدی به اسپارک 👋'}
        </h1>
        <p className="mt-4 text-sm leading-7 text-gray-500 dark:text-gray-400 md:text-base">
          اسپارک فضای یکپارچه شما برای جلسات، تقویم، پیگیری کارها و ارتباطات سازمانی است. در کمتر از یک دقیقه مسیرهای اصلی را با هم مرور می‌کنیم.
        </p>
      </div>

      <div className="rounded-3xl border border-gray-100 bg-gray-50/70 p-5 dark:border-gray-700 dark:bg-gray-900/40">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <FlowCard icon={<UserRoundCheck className="h-6 w-6" />} label="پروفایل" caption="هویت سازمانی" />
          <FlowCard icon={<CalendarDays className="h-6 w-6" />} label="تقویم" caption="برنامه روزانه" />
          <FlowCard icon={<UsersRound className="h-6 w-6" />} label="جلسات" caption="هماهنگی تیم" />
          <FlowCard icon={<MessageCircle className="h-6 w-6" />} label="گفتگو" caption="همکاری سریع" />
        </div>
      </div>
    </div>
  );
}

function ProfileStep({ required }: { required: boolean }) {
  return (
    <div className="space-y-7">
      <div>
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
          required
            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
            : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
        }`}>
          {required ? 'برای ادامه الزامی است' : 'پیشنهاد می‌شود'}
        </span>
        <h2 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white md:text-3xl">اول پروفایلت را کامل کن</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-500 dark:text-gray-400">
          اطلاعاتی مثل سازمان، سمت، دپارتمان و توضیح کوتاه درباره خودت باعث می‌شود در جلسات، مخاطبین و همکاری‌های تیمی درست شناخته شوی.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-[1.15fr_.85fr]">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900/30">
          <div className="mb-4 flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-gray-100 dark:bg-gray-700" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-36 rounded-full bg-gray-200 dark:bg-gray-700" />
              <div className="h-2.5 w-24 rounded-full bg-gray-100 dark:bg-gray-800" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {['سازمان', 'سمت', 'دپارتمان', 'شهر'].map((item) => (
              <div key={item} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800">
                <div className="text-[11px] text-gray-400">{item}</div>
                <div className="mt-2 h-2.5 w-3/4 rounded-full bg-gray-200 dark:bg-gray-700" />
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <TipItem text="شماره موبایل ثبت‌نامی شما قبلاً تأیید شده است." />
          <TipItem text="اطلاعات حساب اصلی از مسیر امن Auth مدیریت می‌شود." />
          <TipItem text="می‌توانید اطلاعات تکمیلی را بعداً نیز ویرایش کنید." />
        </div>
      </div>
    </div>
  );
}

function WorkStep() {
  return (
    <div className="space-y-7">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white md:text-3xl">روز کاریت را از همین‌جا مدیریت کن</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-500 dark:text-gray-400">
          دعوت جلسه، تقویم، کارهای پیگیری و گفتگوهای سازمانی کنار هم قرار گرفته‌اند تا برای هر کار مجبور نباشی بین چند سامانه جابه‌جا شوی.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <FeatureCard
          icon={<CalendarDays className="h-5 w-5" />}
          title="تقویم و جلسات"
          description="جلسات امروز، دعوت‌ها و زمان‌بندی‌ها را یکجا ببین."
        />
        <FeatureCard
          icon={<UsersRound className="h-5 w-5" />}
          title="پیگیری تصمیم‌ها"
          description="مصوبات و کارهای بعد از جلسه را تا نتیجه نهایی دنبال کن."
        />
        <FeatureCard
          icon={<MessageCircle className="h-5 w-5" />}
          title="گفتگو و کانال‌ها"
          description="با همکاران گفتگو کن و اطلاعات مرتبط با کار را کنار هم نگه دار."
        />
      </div>

      <div className="rounded-2xl border border-dashed border-teal-200 bg-teal-50/50 p-4 text-sm leading-7 text-teal-800 dark:border-teal-900 dark:bg-teal-950/20 dark:text-teal-300">
        منوی اصلی همیشه مسیر سریع دسترسی به این بخش‌هاست؛ لازم نیست چیزی را حفظ کنی.
      </div>
    </div>
  );
}

function SecurityStep({ required }: { required: boolean }) {
  return (
    <div className="space-y-7">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white md:text-3xl">امنیت و اعلان‌ها را به سلیقه خودت تنظیم کن</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-gray-500 dark:text-gray-400">
          بعد از ورود می‌توانی روش احراز هویت دومرحله‌ای، نشست‌های فعال و کانال‌های دریافت اعلان را از بخش حساب و امنیت مدیریت کنی.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <FeatureCard
          icon={<ShieldCheck className="h-5 w-5" />}
          title="امنیت حساب"
          description="TOTP یا روش‌های مجاز سازمان، نشست‌های فعال و کنترل‌های امنیتی حساب."
        />
        <FeatureCard
          icon={<BellRing className="h-5 w-5" />}
          title="اعلان‌ها"
          description="اعلان داخل سامانه و کانال‌های ارتباطی فعال سازمان را مدیریت کن."
        />
      </div>

      {required && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300">
          با پایان یا رد کردن این راهنما، مرحله اجباری «تکمیل پروفایل» همچنان اجرا می‌شود. راهنما هیچ Gate امنیتی را دور نمی‌زند.
        </div>
      )}
    </div>
  );
}

function FlowCard({ icon, label, caption }: { icon: ReactNode; label: string; caption: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300">
        {icon}
      </div>
      <div className="mt-3 text-sm font-semibold text-gray-800 dark:text-white">{label}</div>
      <div className="mt-1 text-xs text-gray-400">{caption}</div>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900/30">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300">
        {icon}
      </div>
      <h3 className="mt-4 text-sm font-bold text-gray-800 dark:text-white">{title}</h3>
      <p className="mt-2 text-xs leading-6 text-gray-500 dark:text-gray-400">{description}</p>
    </div>
  );
}

function TipItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-gray-50 p-3 text-xs leading-6 text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
      <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-teal-500" />
      <span>{text}</span>
    </div>
  );
}
