import { TasksPage } from '../../components/TasksPage';
import { ReportsPage } from '../../components/ReportsPage';
import { NotesPage } from '../../components/NotesPage';
import { ProfilePage } from '../../components/ProfilePage';
import { ContactsPage } from '../../components/ContactsPage';
import { ContactsEmailPage } from '../../components/ContactsEmailPage';
import { CalendarPage } from '../../components/CalendarPage';
import { TutorialPage } from '../../components/Tutorial';
import { ChatPage } from '../../components/Chat/ChatPage';
import { VideoConferencePage } from '../../components/VideoConference/VideoConferencePage';
import { PortalConfigPage } from '../../components/PortalConfigPage';
import { SparkPage } from '../../components/Spark/SparkPage';
import { GroupsPage } from '../../components/GroupsPage';
import { ChannelsPage } from '../../components/Channels/ChannelsPage';
import { MinutesDashboardPage } from '../../components/Minutes/MinutesDashboardPage';
import { MinutesHubPage } from '../../components/Minutes/MinutesHubPage';
import { MinutesListPage } from '../../components/Minutes/MinutesListPage';
import { MinutesFormPage } from '../../components/Minutes/MinutesFormPage';
import { MinutesDetailPage } from '../../components/Minutes/MinutesDetailPage';
import { MinutesApprovalsPage } from '../../components/Minutes/MinutesApprovalsPage';
import { MyDecisionsPage } from '../../components/Minutes/MyDecisionsPage';
import { DecisionsFollowupPage } from '../../components/Minutes/DecisionsFollowupPage';
import { MinutesMeetingReportPage } from '../../components/Minutes/MinutesMeetingReportPage';
import { MinutesReportsPage } from '../../components/Minutes/MinutesReportsPage';
import { PageId } from '../navigation/useNavigation';
import { PAGE_PERMISSION_KEY, checkPermission, AccessDenied } from '../../features/permissions';
import { MeetingsPage, CreateMeetingPage } from '../../features/meetings';
import { PageRendererProps } from './pageRendererTypes';

export function renderContent(props: PageRendererProps): React.ReactNode {
  const {
    activePage, setActivePage, navigate, isAdmin, currentUserId, userPermissions,
    fetchMeetings,
    pendingSchedule, setPendingSchedule,
    chatMentionParticipants, setChatMentionParticipants,
    chatMeetingNotes, setChatMeetingNotes,
    taskPrefillDescription, setTaskPrefillDescription,
    taskPrefillMessageId, setTaskPrefillMessageId,
    sparkMeetingPrefill, setSparkMeetingPrefill,
    setSparkExternalCommand,
    sparkCalendarView, setSparkCalendarView,
    sparkNavigateDate, setSparkNavigateDate,
    sparkCalendarMeetingPrefill, setSparkCalendarMeetingPrefill,
    chatInitUserId, setChatInitUserId,
    sparkVisible,
    minutesFollowupAllowed,
    minutesFollowupAccessLoading,
  } = props;

  // While permissions are still loading, show a spinner instead of "access denied"
  if (userPermissions === undefined && !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (activePage === 'minutes-followup') {
    if (minutesFollowupAccessLoading) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
          <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">در حال بررسی دسترسی...</span>
        </div>
      );
    }
    if (!minutesFollowupAllowed) {
      return <AccessDenied onReturn={() => navigate('profile')} />;
    }
  }

  const permKey = PAGE_PERMISSION_KEY[activePage];
  if (permKey && !checkPermission(permKey, isAdmin, userPermissions)) {
    return <AccessDenied onReturn={() => navigate('profile')} />;
  }

  switch (activePage) {
    case 'calendar':
      return <CalendarPage
        pendingSchedule={pendingSchedule}
        onScheduleComplete={() => { setPendingSchedule(null); void fetchMeetings(); }}
        pendingMentionParticipants={chatMentionParticipants.length > 0 ? chatMentionParticipants : undefined}
        pendingMentionNotes={chatMeetingNotes || undefined}
        onPendingMentionConsumed={() => { setChatMentionParticipants([]); setChatMeetingNotes(''); }}
        initialView={sparkCalendarView || undefined}
        onViewConsumed={() => setSparkCalendarView(null)}
        sparkNavigateDate={sparkNavigateDate}
        onSparkNavigateDateConsumed={() => setSparkNavigateDate(null)}
        sparkCalendarMeetingPrefill={sparkCalendarMeetingPrefill}
        onSparkCalendarMeetingPrefillConsumed={() => setSparkCalendarMeetingPrefill(null)}
        onRegisterMinutes={(meetingId, existingMinuteId) => {
          try {
            const url = new URL(window.location.href);
            if (existingMinuteId) {
              url.searchParams.set('minute', existingMinuteId);
              url.searchParams.delete('meeting');
              window.history.replaceState({}, '', url.toString());
              navigate('minutes-detail');
            } else {
              url.searchParams.set('meeting', meetingId);
              url.searchParams.delete('minute');
              window.history.replaceState({}, '', url.toString());
              navigate('minutes-new');
            }
          } catch (err) {
            if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
              console.error('[PageRenderer] onRegisterMinutes navigation failed:', err);
            }
          }
        }}
      />;
    case 'chat':
      return <ChatPage
        onNavigateToCalendar={(ids, bodyText) => {
          if (ids && ids.length > 0) setChatMentionParticipants(ids);
          if (bodyText) setChatMeetingNotes(bodyText);
          navigate('calendar');
        }}
        onNavigateToTasks={(messageBody, messageId) => {
          setTaskPrefillDescription(messageBody);
          setTaskPrefillMessageId(messageId);
          navigate('tasks');
        }}
        initialOpenUserId={chatInitUserId}
        onInitialOpenUserConsumed={() => setChatInitUserId(null)}
      />;
    case 'create-meeting':
      return <CreateMeetingPage
        prefillData={sparkMeetingPrefill}
        setActivePage={navigate}
        setSparkMeetingPrefill={setSparkMeetingPrefill}
        fetchMeetings={fetchMeetings}
      />;
    case 'video-conference':
      return <VideoConferencePage />;
    case 'portal-config':
      return isAdmin && currentUserId ? <PortalConfigPage currentUserId={currentUserId} /> : null;
    case 'tasks':
      return <TasksPage
        prefillDescription={taskPrefillDescription || undefined}
        prefillSourceMessageId={taskPrefillMessageId || undefined}
        onPrefillConsumed={() => { setTaskPrefillDescription(''); setTaskPrefillMessageId(''); }}
        currentUserId={currentUserId}
      />;
    case 'reports':
      return <ReportsPage />;
    case 'notes':
      return <NotesPage currentUserId={currentUserId} />;
    case 'profile':
      return <ProfilePage />;
    case 'contacts':
      return <ContactsPage currentUserId={currentUserId} />;
    case 'contacts_email':
      return <ContactsEmailPage currentUserId={currentUserId} />;
    case 'tutorial':
      return <TutorialPage onAskSpark={(cmd) => { setSparkExternalCommand(cmd); }} />;
    case 'spark':
      if (!sparkVisible) { navigate('calendar'); return null; }
      return <SparkPage onSendToAssistant={(cmd) => { setSparkExternalCommand(cmd); navigate('spark'); }} />;
    case 'groups':
      return <GroupsPage currentUserId={currentUserId} isAdmin={isAdmin} />;
    case 'channels':
      return <ChannelsPage currentUserId={currentUserId} isAdmin={isAdmin} onNavigateToTasks={(body, id) => {
        setTaskPrefillDescription(body);
        setTaskPrefillMessageId(id);
        navigate('tasks');
      }} onOpenDirectChat={(userId) => {
        setChatInitUserId(userId);
        navigate('chat');
      }} />;
    case 'minutes-hub': {
      const hubCards = new Set<PageId>();
      if (checkPermission('minutes_view', isAdmin, userPermissions)) {
        hubCards.add('minutes-dashboard');
        hubCards.add('minutes');
        hubCards.add('minutes-my-decisions');
      }
      if (checkPermission('minutes_approve', isAdmin, userPermissions)) {
        hubCards.add('minutes-approvals');
      }
      if (checkPermission('minutes_reports', isAdmin, userPermissions)) {
        hubCards.add('minutes-reports');
      }
      if (minutesFollowupAllowed) {
        hubCards.add('minutes-followup');
      }
      return <MinutesHubPage onNavigate={(p) => navigate(p as PageId)} visibleCards={hubCards} />;
    }
    case 'minutes-dashboard':
      return <MinutesDashboardPage onNavigate={(p) => navigate(p as PageId)} />;
    case 'minutes':
      return <MinutesListPage onNavigate={(p) => navigate(p as PageId)} />;
    case 'minutes-new':
      return <MinutesFormPage mode="new" onNavigate={(p) => navigate(p as PageId)} />;
    case 'minutes-edit':
      return <MinutesFormPage mode="edit" onNavigate={(p) => navigate(p as PageId)} />;
    case 'minutes-detail':
      return <MinutesDetailPage onNavigate={(p) => navigate(p as PageId)} currentUserId={currentUserId || undefined} isAdmin={isAdmin} />;
    case 'minutes-approvals':
      return <MinutesApprovalsPage onNavigate={(p) => navigate(p as PageId)} currentUserId={currentUserId || undefined} />;
    case 'minutes-my-decisions':
      return <MyDecisionsPage onNavigate={(p) => navigate(p as PageId)} />;
    case 'minutes-followup':
      return <DecisionsFollowupPage onNavigate={(p) => navigate(p as PageId)} />;
    case 'minutes-report':
      return <MinutesMeetingReportPage onNavigate={(p) => navigate(p as PageId)} />;
    case 'minutes-reports':
      return <MinutesReportsPage onNavigate={(p) => navigate(p as PageId)} />;
    default:
      return <MeetingsPage
        meetings={props.meetings}
        pendingMeetingsCount={props.pendingMeetingsCount}
        fetchMeetings={props.fetchMeetings}
        fetchPendingMeetingsCount={props.fetchPendingMeetingsCount}
        searchTerm={props.searchTerm}
        setSearchTerm={props.setSearchTerm}
        statusFilter={props.statusFilter}
        setStatusFilter={props.setStatusFilter}
        priorityFilter={props.priorityFilter}
        setPriorityFilter={props.setPriorityFilter}
        showPendingMeetingsModal={props.showPendingMeetingsModal}
        setShowPendingMeetingsModal={props.setShowPendingMeetingsModal}
        setActivePage={props.navigate}
        setPendingSchedule={props.setPendingSchedule}
        isAdmin={props.isAdmin}
        userPermissions={props.userPermissions}
      />;
  }
}
