import { lazy, Suspense, useEffect, useState } from 'react';
import SparkLoader from './components/ui/SparkLoader';
import { supabase } from './lib/supabase';

const PublicAuthRoot = lazy(() => import('./PublicAuthRoot'));
const AuthenticatedRoot = lazy(() => import('./AuthenticatedRoot'));
const GuestApplication = lazy(() => import('./GuestApplication'));

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

  return (
    <Suspense fallback={<SparkLoader message="در حال بارگذاری سامانه..." />}>
      <AuthenticatedRoot />
    </Suspense>
  );
}

function RootApp() {
  const conferenceCode = new URLSearchParams(window.location.search).get('conference');

  if (conferenceCode) {
    return (
      <Suspense fallback={<SparkLoader message="در حال بارگذاری..." />}>
        <GuestApplication code={conferenceCode} />
      </Suspense>
    );
  }

  return <StandardApplication />;
}

export default RootApp;
