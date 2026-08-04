import { lazy, Suspense } from 'react';

const AuthenticatedApp = lazy(() => import('./AuthenticatedApp'));
const GuestJoinPage = lazy(() => import('./components/VideoConference/GuestJoinPage').then(m => ({ default: m.GuestJoinPage })));

function RootApp() {
  const conferenceCode = new URLSearchParams(window.location.search).get('conference');

  if (conferenceCode) {
    return (
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-gray-950" />}>
        <GuestJoinPage code={conferenceCode} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    }>
      <AuthenticatedApp />
    </Suspense>
  );
}

export default RootApp;
