import { useState, useEffect } from 'react';
import { AuthPage } from './components/AuthPage';
import { AdminDashboard } from './components/AdminDashboard';
import { GuestJoinPage } from './components/VideoConference/GuestJoinPage';
import { supabase } from './lib/supabase';
import { Toaster } from 'react-hot-toast';
import { Wrench } from 'lucide-react';
import { useUserPreferences } from './context/UserPreferencesContext';
import { useAuthSession } from './features/auth';
import { useMeetingsData } from './features/meetings';
import { useMaintenanceMode } from './app/hooks/useMaintenanceMode';
import { useSparkVisibility } from './app/hooks/useSparkVisibility';
import { useNavigation, useAdminPathGuard } from './app/navigation/useNavigation';
import { AppShell } from './app/layout/AppShell';
import { SparkMeetingPrefill } from './components/Spark/SparkAssistant';
import { Meeting } from './types';
import { PageRendererProps } from './app/navigation/pageRendererTypes';

function App() {
  const conferenceCode = new URLSearchParams(window.location.search).get('conference');

  const { isAuthenticated, loading, isAdmin, currentUserId, userPermissions } = useAuthSession();
  const { prefs, loading: prefsLoading } = useUserPreferences();
  const { activePage, setActivePage } = useNavigation(isAuthenticated, prefsLoading, prefs.default_landing_page);
  const maintenanceMode = useMaintenanceMode();
  const sparkVisible = useSparkVisibility();
  const { meetings, pendingMeetingsCount, fetchMeetings, fetchPendingMeetingsCount } = useMeetingsData(isAuthenticated);

  useAdminPathGuard(isAuthenticated, isAdmin, setActivePage);

  const [showSplash, setShowSplash] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  useEffect(() => { setSplashDone(true); }, []);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'archived'>('open');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [showPendingMeetingsModal, setShowPendingMeetingsModal] = useState(false);
  const [pendingSchedule, setPendingSchedule] = useState<{ meetingId: string; meeting: Meeting } | null>(null);
  const [chatMentionParticipants, setChatMentionParticipants] = useState<string[]>([]);
  const [chatMeetingNotes, setChatMeetingNotes] = useState('');
  const [taskPrefillDescription, setTaskPrefillDescription] = useState('');
  const [taskPrefillMessageId, setTaskPrefillMessageId] = useState('');
  const [sparkMeetingPrefill, setSparkMeetingPrefill] = useState<SparkMeetingPrefill | null>(null);
  const [sparkExternalCommand, setSparkExternalCommand] = useState<string | null>(null);
  const [sparkCalendarView, setSparkCalendarView] = useState<string | null>(null);
  const [sparkNavigateDate, setSparkNavigateDate] = useState<{ jy: number; jm: number; jd: number; view?: string } | null>(null);
  const [sparkCalendarMeetingPrefill, setSparkCalendarMeetingPrefill] = useState<unknown>(null);
  const [chatInitUserId, setChatInitUserId] = useState<string | null>(null);

  if (conferenceCode) {
    return <GuestJoinPage code={conferenceCode} />;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <Toaster position="top-center" toastOptions={{ duration: 4000 }} />
        <AuthPage onSuccess={() => {
          void supabase.from('system_config').select('value').eq('section', 'appearance').eq('key', 'splash_enabled').maybeSingle().then(({ data }) => {
            const enabled = !data || data.value === 'true' || data.value === null;
            if (enabled && !sessionStorage.getItem('spark_splash_shown')) {
              sessionStorage.setItem('spark_splash_shown', '1');
              setShowSplash(true);
              setSplashDone(false);
            }
          }).catch(() => {});
          setActivePage('calendar');
        }} />
      </>
    );
  }

  if (activePage === 'admin' && isAdmin) {
    return <AdminDashboard />;
  }

  if (maintenanceMode && !isAdmin) {
    return (
      <>
        <Toaster position="top-center" toastOptions={{ duration: 4000 }} />
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900" dir="rtl">
          <div className="flex flex-col items-center gap-6 text-center max-w-md px-6">
            <div className="w-20 h-20 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <Wrench className="w-10 h-10 text-amber-500" />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-gray-800 dark:text-white">سیستم در حال تعمیر است</h1>
              <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">
                در حال حاضر سیستم به دلیل عملیات نگهداری در دسترس نیست. لطفاً کمی بعد مجدداً تلاش کنید.
              </p>
            </div>
            <button onClick={() => supabase.auth.signOut()} className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition-colors">
              خروج از حساب
            </button>
          </div>
        </div>
      </>
    );
  }

  const rendererProps: PageRendererProps = {
    activePage, setActivePage, isAdmin, currentUserId, userPermissions,
    meetings, pendingMeetingsCount, fetchMeetings, fetchPendingMeetingsCount,
    searchTerm, setSearchTerm, statusFilter, setStatusFilter,
    priorityFilter, setPriorityFilter,
    showPendingMeetingsModal, setShowPendingMeetingsModal,
    pendingSchedule, setPendingSchedule,
    chatMentionParticipants, setChatMentionParticipants,
    chatMeetingNotes, setChatMeetingNotes,
    taskPrefillDescription, setTaskPrefillDescription,
    taskPrefillMessageId, setTaskPrefillMessageId,
    sparkMeetingPrefill, setSparkMeetingPrefill,
    sparkExternalCommand, setSparkExternalCommand,
    sparkCalendarView, setSparkCalendarView,
    sparkNavigateDate, setSparkNavigateDate,
    sparkCalendarMeetingPrefill, setSparkCalendarMeetingPrefill,
    chatInitUserId, setChatInitUserId,
    sparkVisible,
  };

  return (
    <AppShell
      isAdmin={isAdmin}
      currentUserId={currentUserId}
      userPermissions={userPermissions}
      activePage={activePage}
      setActivePage={setActivePage}
      showSplash={showSplash}
      splashDone={splashDone}
      onSplashDone={() => { setShowSplash(false); setSplashDone(true); }}
      sparkVisible={sparkVisible}
      rendererProps={rendererProps}
      sparkProps={{
        sparkExternalCommand,
        onExternalCommandConsumed: () => setSparkExternalCommand(null),
        onSetCalendarView: (view) => { setSparkCalendarView(view); },
        onOpenMeetingForm: (prefill) => { setSparkMeetingPrefill(prefill); },
        onOpenCalendarMeetingForm: (prefill) => { setSparkCalendarMeetingPrefill(prefill); },
        onNavigateToDate: (jy, jm, jd, view) => { setSparkNavigateDate({ jy, jm, jd, view }); },
      }}
    />
  );
}

export default App;
