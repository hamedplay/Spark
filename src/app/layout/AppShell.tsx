import { PermissionsProvider } from '../../context/PermissionsContext';
import { GlobalCallProvider } from '../../context/GlobalCallContext';
import { Toaster } from 'react-hot-toast';
import { useTheme } from '../../context/ThemeContext';
import { SplashScreen } from '../../components/SplashScreen';
import { SparkAssistant, SparkMeetingPrefill } from '../../components/Spark/SparkAssistant';
import { PageId } from '../navigation/useNavigation';
import { Layout } from '../../components/Layout';
import { renderContent } from '../navigation/PageRenderer';
import { PageRendererProps } from '../navigation/pageRendererTypes';

interface AppShellProps {
  isAdmin: boolean;
  currentUserId: string | null;
  userPermissions: Record<string, boolean> | null | undefined;
  activePage: PageId;
  setActivePage: (page: PageId) => void;
  showSplash: boolean;
  splashDone: boolean;
  onSplashDone: () => void;
  sparkVisible: boolean;
  rendererProps: PageRendererProps;
  sparkProps: {
    sparkExternalCommand: string | null;
    onExternalCommandConsumed: () => void;
    onSetCalendarView: (view: string) => void;
    onOpenMeetingForm: (prefill: SparkMeetingPrefill) => void;
    onOpenCalendarMeetingForm: (prefill: unknown) => void;
    onNavigateToDate: (jy: number, jm: number, jd: number, view?: string) => void;
  };
}

export function AppShell(props: AppShellProps) {
  const {
    isAdmin, currentUserId, userPermissions,
    activePage, setActivePage,
    showSplash, splashDone, onSplashDone,
    sparkVisible, rendererProps, sparkProps,
  } = props;

  const { theme } = useTheme();

  return (
    <PermissionsProvider isAdmin={isAdmin} userPermissions={userPermissions}>
      <GlobalCallProvider
        currentUserId={currentUserId}
        onNavigateToChat={() => setActivePage('chat')}
        onNavigateToChannels={() => setActivePage('channels')}
        onNavigateToVideoConference={() => setActivePage('video-conference')}
      >
        {showSplash && !splashDone && (
          <SplashScreen onDone={onSplashDone} />
        )}
        <Toaster
          position="top-center"
          containerStyle={{
            top: 'calc(env(safe-area-inset-top, 0px) + 64px)',
          }}
          toastOptions={{
            style: {
              background: theme === 'dark' ? '#374151' : '#fff',
              color: theme === 'dark' ? '#fff' : '#000',
            },
          }}
        />
        <Layout activePage={activePage} onPageChange={(p) => setActivePage(p as PageId)} isAdmin={isAdmin} userPermissions={userPermissions} sparkVisible={sparkVisible}
        >
          {renderContent(rendererProps)}
        </Layout>
        {currentUserId && sparkVisible && (
          <SparkAssistant
            currentUserId={currentUserId}
            onNavigate={(page) => setActivePage(page as PageId)}
            onSetCalendarView={(view) => { sparkProps.onSetCalendarView(view); setActivePage('calendar'); }}
            onOpenMeetingForm={(prefill) => {
              sparkProps.onOpenMeetingForm(prefill);
              setActivePage('create-meeting');
            }}
            onOpenCalendarMeetingForm={(prefill) => {
              sparkProps.onOpenCalendarMeetingForm(prefill);
              setActivePage('calendar');
            }}
            onNavigateToDate={(jy, jm, jd, view) => {
              sparkProps.onNavigateToDate(jy, jm, jd, view);
              setActivePage('calendar');
            }}
            externalCommand={sparkProps.sparkExternalCommand}
            onExternalCommandConsumed={sparkProps.onExternalCommandConsumed}
          />
        )}
      </GlobalCallProvider>
    </PermissionsProvider>
  );
}
