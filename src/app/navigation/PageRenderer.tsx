import { Search, Plus, Bell, X } from 'lucide-react';
import { Dashboard } from '../../components/Dashboard';
import { MeetingCard } from '../../components/MeetingCard';
import { CreateMeetingForm } from '../../components/CreateMeetingForm';
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
import { MinutesListPage } from '../../components/Minutes/MinutesListPage';
import { MinutesFormPage } from '../../components/Minutes/MinutesFormPage';
import { MinutesDetailPage } from '../../components/Minutes/MinutesDetailPage';
import { MinutesApprovalsPage } from '../../components/Minutes/MinutesApprovalsPage';
import { MyDecisionsPage } from '../../components/Minutes/MyDecisionsPage';
import { DecisionsFollowupPage } from '../../components/Minutes/DecisionsFollowupPage';
import { MinutesMeetingReportPage } from '../../components/Minutes/MinutesMeetingReportPage';
import { MinutesReportsPage } from '../../components/Minutes/MinutesReportsPage';
import { PendingMeetingsModal } from '../../components/MeetingCard/PendingMeetingsModal';
import { PageId } from '../navigation/useNavigation';
import { PAGE_PERMISSION_KEY, checkPermission, AccessDenied } from '../../features/permissions';
import { PageRendererProps } from './pageRendererTypes';

export function renderContent(props: PageRendererProps): React.ReactNode {
  const {
    activePage, setActivePage, isAdmin, currentUserId, userPermissions,
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
  } = props;

  // While permissions are still loading, show a spinner instead of "access denied"
  if (userPermissions === undefined && !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
      </div>
    );
  }
  const permKey = PAGE_PERMISSION_KEY[activePage];
  if (permKey && !checkPermission(permKey, isAdmin, userPermissions)) {
    return <AccessDenied onReturn={() => setActivePage('profile')} />;
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
      />;
    case 'chat':
      return <ChatPage
        onNavigateToCalendar={(ids, bodyText) => {
          if (ids && ids.length > 0) setChatMentionParticipants(ids);
          if (bodyText) setChatMeetingNotes(bodyText);
          setActivePage('calendar');
        }}
        onNavigateToTasks={(messageBody, messageId) => {
          setTaskPrefillDescription(messageBody);
          setTaskPrefillMessageId(messageId);
          setActivePage('tasks');
        }}
        initialOpenUserId={chatInitUserId}
        onInitialOpenUserConsumed={() => setChatInitUserId(null)}
      />;
    case 'create-meeting':
      return (
        <div>
          <div className="flex items-center gap-3 mb-6">
            <button
              onClick={() => { setActivePage('meetings'); setSparkMeetingPrefill(null); }}
              className="flex items-center gap-2 text-gray-500 dark:text-gray-400 hover:text-blue-500 transition-colors text-sm"
            >
              <X className="w-4 h-4" />
              بازگشت
            </button>
            <h2 className="text-2xl font-bold dark:text-white">ایجاد جلسه جدید</h2>
          </div>
          <CreateMeetingForm
            prefillData={sparkMeetingPrefill || undefined}
            onSuccess={() => {
              setActivePage('meetings');
              setSparkMeetingPrefill(null);
              void fetchMeetings();
            }}
          />
        </div>
      );
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
      if (!sparkVisible) { setActivePage('calendar'); return null; }
      return <SparkPage onSendToAssistant={(cmd) => { setSparkExternalCommand(cmd); setActivePage('spark'); }} />;
    case 'groups':
      return <GroupsPage currentUserId={currentUserId} isAdmin={isAdmin} />;
    case 'channels':
      return <ChannelsPage currentUserId={currentUserId} isAdmin={isAdmin} onNavigateToTasks={(body, id) => {
        setTaskPrefillDescription(body);
        setTaskPrefillMessageId(id);
        setActivePage('tasks');
      }} onOpenDirectChat={(userId) => {
        setChatInitUserId(userId);
        setActivePage('chat');
      }} />;
    case 'minutes-dashboard':
      return <MinutesDashboardPage onNavigate={(p) => setActivePage(p as PageId)} />;
    case 'minutes':
      return <MinutesListPage onNavigate={(p) => setActivePage(p as PageId)} />;
    case 'minutes-new':
      return <MinutesFormPage mode="new" onNavigate={(p) => setActivePage(p as PageId)} />;
    case 'minutes-edit':
      return <MinutesFormPage mode="edit" onNavigate={(p) => setActivePage(p as PageId)} />;
    case 'minutes-detail':
      return <MinutesDetailPage onNavigate={(p) => setActivePage(p as PageId)} currentUserId={currentUserId || undefined} isAdmin={isAdmin} />;
    case 'minutes-approvals':
      return <MinutesApprovalsPage onNavigate={(p) => setActivePage(p as PageId)} currentUserId={currentUserId || undefined} />;
    case 'minutes-my-decisions':
      return <MyDecisionsPage onNavigate={(p) => setActivePage(p as PageId)} />;
    case 'minutes-followup':
      return <DecisionsFollowupPage onNavigate={(p) => setActivePage(p as PageId)} />;
    case 'minutes-report':
      return <MinutesMeetingReportPage onNavigate={(p) => setActivePage(p as PageId)} />;
    case 'minutes-reports':
      return <MinutesReportsPage onNavigate={(p) => setActivePage(p as PageId)} />;
    default:
      return renderMeetingsPage(props);
  }
}

function renderMeetingsPage(props: PageRendererProps): React.ReactNode {
  const {
    meetings, pendingMeetingsCount, fetchMeetings, fetchPendingMeetingsCount,
    searchTerm, setSearchTerm, statusFilter, setStatusFilter,
    priorityFilter, setPriorityFilter,
    showPendingMeetingsModal, setShowPendingMeetingsModal,
    setActivePage, setPendingSchedule,
    isAdmin, userPermissions,
  } = props;

  const filteredMeetings = meetings.filter(meeting => {
    const matchesSearch = meeting.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         meeting.representative.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || meeting.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || meeting.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const stats = {
    totalMeetings: meetings.length,
    openMeetings: meetings.filter(m => m.status === 'open').length,
    completedMeetings: meetings.filter(m => m.status === 'archived').length,
    pendingMeetingsCount: pendingMeetingsCount
  };

  const hasPermission = (key: string): boolean => checkPermission(key, isAdmin, userPermissions);

  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <h2 className="text-2xl font-bold dark:text-white">درخواست جلسات</h2>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={() => setShowPendingMeetingsModal(true)}
            className="flex items-center gap-2 bg-yellow-500 text-white px-4 py-2 rounded-lg hover:bg-yellow-600 transition-colors w-full sm:w-auto justify-center relative"
          >
            <Bell className="w-5 h-5" />
            جلسات در انتظار تایید
            {pendingMeetingsCount > 0 && (
              <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full">
                {pendingMeetingsCount}
              </span>
            )}
          </button>
          {hasPermission('meetings_create') && (
            <button
              onClick={() => setActivePage('create-meeting')}
              className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors w-full sm:w-auto justify-center"
            >
              <Plus className="w-5 h-5" />
              جلسه جدید
            </button>
          )}
        </div>
      </div>

      <Dashboard {...stats} />

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="جستجو..."
            className="w-full pl-4 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value as 'all' | 'high' | 'medium' | 'low')}
          className="w-full sm:w-auto px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
        >
          <option value="all">همه اولویت‌ها</option>
          <option value="high">اولویت بالا</option>
          <option value="medium">اولویت متوسط</option>
          <option value="low">اولویت پایین</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'open' | 'archived')}
          className="w-full sm:w-auto px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
        >
          <option value="all">همه جلسات</option>
          <option value="open">جلسات باز</option>
          <option value="archived">جلسات بایگانی شده</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredMeetings.map(meeting => (
          <MeetingCard
            key={meeting.id}
            meeting={meeting}
            onUpdate={fetchMeetings}
            onScheduleInCalendar={(m) => {
              setPendingSchedule({ meetingId: m.id, meeting: m });
              setActivePage('calendar');
            }}
          />
        ))}
      </div>

      {showPendingMeetingsModal && (
        <PendingMeetingsModal
          onClose={() => setShowPendingMeetingsModal(false)}
          onUpdate={() => {
            void fetchMeetings();
            void fetchPendingMeetingsCount();
          }}
        />
      )}
    </>
  );
}
