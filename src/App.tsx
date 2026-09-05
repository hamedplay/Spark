import { lazy, Suspense, useEffect, useState } from 'react';
import SparkLoader from './components/ui/SparkLoader';
import { isKnownSparkPath, isStandaloneConferencePath } from './app/navigation/rootPath';
import { supabase } from './lib/supabase';

const PublicAuthRoot = lazy(() => import('./PublicAuthRoot'));
const AuthenticatedRoot = lazy(() => import('./AuthenticatedRoot'));
const StandaloneConferenceRoot = lazy(() => import('./StandaloneConferenceRoot'));
const NotFoundPage = lazy(() => import('./features/not-found/pages/NotFoundPage'));

type RootAuthState = 'checking' | 'public' | 'authenticated';

function StandardApplication() {
  const [authState, setAuthState] = useState<RootAuthState>('checking');

  useEffect(() => {
    let active = true;

    void supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (active) setAuthState(session ? 'authenticated' : 'public');
      })
      .catch(() => {
        if (active) setAuthState('public');
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setAuthState(session ? 'authenticated' : 'public');
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  if (authState === 'checking') {
    return <SparkLoader message="در حال بررسی نشست..." />;
  }

  if (authState === 'public') {
    return (
      <Suspense fallback={<SparkLoader message="در حال بارگذاری صفحه ورود..." />}>
        <PublicAuthRoot onSessionEstablished={() => setAuthState('authenticated')} />
      </Suspense>
    );
  }

  if (isStandaloneConferencePath(window.location.pathname)) {
    return (
      <Suspense fallback={<SparkLoader message="در حال آماده‌سازی جلسه..." />}>
        <StandaloneConferenceRoot />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<SparkLoader message="در حال بارگذاری سامانه..." />}>
      <AuthenticatedRoot />
    </Suspense>
  );
}

function RootApp() {
  if (!isKnownSparkPath(window.location.pathname)) {
    return (
      <Suspense fallback={<SparkLoader message="در حال بارگذاری صفحه..." />}>
        <NotFoundPage />
      </Suspense>
    );
  }

  return <StandardApplication />;
}

export default RootApp;
