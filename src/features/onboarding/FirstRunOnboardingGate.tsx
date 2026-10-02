import { lazy, Suspense, type ReactNode, useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

const WelcomeOnboarding = lazy(() =>
  import('./WelcomeOnboarding').then((module) => ({ default: module.WelcomeOnboarding })),
);

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
      // Warm the presentation chunk only when the deferred onboarding check runs.
      // Returning users never pay the parse/execute cost during initial app startup.
      void import('./WelcomeOnboarding');

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

    let timer: number | null = null;
    let idleId: number | null = null;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(() => void load(), { timeout: 2200 });
    } else {
      timer = window.setTimeout(() => void load(), 1400);
    }

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (idleId !== null) idleWindow.cancelIdleCallback?.(idleId);
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
    <Suspense fallback={<div className="min-h-screen bg-white dark:bg-gray-950" aria-hidden="true" />}>
      <WelcomeOnboarding
        fullName={fullName}
        profileCompletionRequired={profileCompletionRequired}
        onSkip={() => void acknowledge('skipped')}
        onComplete={() => void acknowledge('completed')}
      />
    </Suspense>
  );
}

