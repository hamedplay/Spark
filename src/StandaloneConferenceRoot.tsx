import { useEffect } from 'react';
import StandaloneConferencePage from './components/VideoConference/StandaloneConferencePage';
import { RestrictedAccessPage } from './components/RestrictedAccessPage';
import SparkLoader from './components/ui/SparkLoader';
import { useAuthSession } from './features/auth';
import { supabase } from './lib/supabase';

const REAUTH_REASON_CODES = new Set([
  'SESSION_REQUIRED',
  'SESSION_INVALID',
  'SESSION_EXPIRED',
  'SESSION_SECURITY_STATE_MISSING',
  'SESSION_REVOKED',
  'SESSION_ABSOLUTE_EXPIRED',
  'SESSION_IDLE_EXPIRED',
  'SESSION_EPOCH_MISMATCH',
  'PASSWORD_GATEWAY_REQUIRED',
]);

export default function StandaloneConferenceRoot() {
  const authSession = useAuthSession();
  const reasonCode = authSession.reasonCode ? String(authSession.reasonCode) : null;
  const shouldReauthenticate =
    !authSession.loading
    && authSession.hasSession
    && !authSession.isFullyAuthorized
    && authSession.nextStep === 'login'
    && reasonCode !== null
    && REAUTH_REASON_CODES.has(reasonCode);

  useEffect(() => {
    if (!shouldReauthenticate) return;
    void supabase.auth.signOut({ scope: 'local' });
  }, [shouldReauthenticate]);

  if (authSession.loading || shouldReauthenticate) {
    return <SparkLoader message="در حال بررسی نشست جلسه..." />;
  }

  if (!authSession.hasSession) {
    return <SparkLoader message="در حال انتقال به صفحه ورود..." />;
  }

  if (!authSession.isFullyAuthorized) {
    return (
      <div className="spark-auth-flow min-h-screen">
        <RestrictedAccessPage
          reasonCode={authSession.reasonCode}
          nextStep={authSession.nextStep}
          onRefresh={authSession.refreshAccessState}
          onSignOut={() => { void supabase.auth.signOut(); }}
        />
      </div>
    );
  }

  return <StandaloneConferencePage />;
}
