import React, { useState, useEffect } from 'react';
import { Dashboard } from './components/Dashboard';
import { MeetingCard } from './components/MeetingCard';
import { CreateMeetingForm } from './components/CreateMeetingForm';
import { AuthPage } from './components/AuthPage';
import { Layout } from './components/Layout';
import { TasksPage } from './components/TasksPage';
import { ReportsPage } from './components/ReportsPage';
import { NotesPage } from './components/NotesPage';
import { ProfilePage } from './components/ProfilePage';
import { ContactsPage } from './components/ContactsPage';
import { ContactsEmailPage } from './components/ContactsEmailPage';
import { CalendarPage } from './components/CalendarPage';
import { TutorialPage } from './components/TutorialPage';
import { AdminDashboard } from './components/AdminDashboard';
import { ChatPage } from './components/Chat/ChatPage';
import { VideoConferencePage } from './components/VideoConference/VideoConferencePage';
import { PortalConfigPage } from './components/PortalConfigPage';
import { GuestJoinPage } from './components/VideoConference/GuestJoinPage';
import { SparkPage } from './components/Spark/SparkPage';
import { SparkAssistant, SparkMeetingPrefill } from './components/Spark/SparkAssistant';
import { SplashScreen } from './components/SplashScreen';
import { GroupsPage } from './components/GroupsPage';
import { ChannelsPage } from './components/Channels/ChannelsPage';
import { supabase, handleSupabaseError } from './lib/supabase';
import { Search, Plus, X, Bell, Calendar, Clock, MapPin, User } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import { Meeting } from './types';
import toast from 'react-hot-toast';
import { PendingMeetingsModal } from './components/MeetingCard/PendingMeetingsModal';
import { useTheme } from './context/ThemeContext';
import { PermissionsProvider } from './context/PermissionsContext';
import { GlobalCallProvider } from './context/GlobalCallContext';

function App() {
  // Check for ?conference=CODE guest join link before anything else
  const conferenceCode = new URLSearchParams(window.location.search).get('conference');
  if (conferenceCode) {
    return <GuestJoinPage code={conferenceCode} />;
  }

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'archived'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activePage, setActivePage] = useState<'meetings' | 'create-meeting' | 'tasks' | 'reports' | 'notes' | 'profile' | 'contacts' | 'contacts_email' | 'calendar' | 'tutorial' | 'admin' | 'chat' | 'video-conference' | 'portal-config' | 'spark' | 'groups' | 'channels'>('calendar');
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [pendingMeetingsCount, setPendingMeetingsCount] = useState(0);
  const [showPendingMeetingsModal, setShowPendingMeetingsModal] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // null = full access (admin), undefined = still loading, {} = no access
  const [userPermissions, setUserPermissions] = useState<Record<string, boolean> | null | undefined>(undefined);
  const [pendingSchedule, setPendingSchedule] = useState<{ meetingId: string; meeting: any } | null>(null);
  const [chatMentionParticipants, setChatMentionParticipants] = useState<string[]>([]);
  const [chatMeetingNotes, setChatMeetingNotes] = useState('');
  const [taskPrefillDescription, setTaskPrefillDescription] = useState('');
  const [taskPrefillMessageId, setTaskPrefillMessageId] = useState('');
  const [sparkMeetingPrefill, setSparkMeetingPrefill] = useState<SparkMeetingPrefill | null>(null);
  const [sparkExternalCommand, setSparkExternalCommand] = useState<string | null>(null);
  const [sparkCalendarView, setSparkCalendarView] = useState<string | null>(null);
  const [sparkNavigateDate, setSparkNavigateDate] = useState<{ jy: number; jm: number; jd: number; view?: string } | null>(null);
  const [sparkCalendarMeetingPrefill, setSparkCalendarMeetingPrefill] = useState<any | null>(null);
  const [chatInitUserId, setChatInitUserId] = useState<string | null>(null);
  const { theme } = useTheme();

  const [sparkVisible, setSparkVisible] = useState(true);

  useEffect(() => {
    const loadSparkVisible = () => {
      supabase
        .from('system_config')
        .select('value')
        .eq('section', 'spark')
        .eq('key', 'spark_visible')
        .maybeSingle()
        .then(({ data }) => {
          setSparkVisible(data ? data.value !== 'false' : true);
        })
        .catch(() => {});
    };

    loadSparkVisible();

    const channel = supabase
      .channel('spark-config-rt')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'system_config',
      }, (payload: any) => {
        if (payload.new?.section === 'spark' && payload.new?.key === 'spark_visible') {
          setSparkVisible(payload.new.value !== 'false');
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    setSplashDone(true); // splash only fires after login, not at app startup

    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      if (!session) {
        setMeetings([]);
        setIsAdmin(false);
        setUserPermissions(undefined);
      } else {
        // Re-load permissions whenever auth state changes (login, token refresh, etc.)
        (async () => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('user_id', session.user.id)
            .maybeSingle();
          const adminStatus = profile?.is_admin === true;
          setIsAdmin(adminStatus);
          setCurrentUserId(session.user.id);
          if (adminStatus) {
            setUserPermissions(null);
          } else {
            await loadUserPermissions(session.user.id);
          }
        })();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserPermissions = async (userId: string) => {
    try {
      // ── ۱. دسترسی‌های گروه‌بندی (روش قدیمی) ──────────────────────────────
      const { data: memberships } = await supabase
        .from('user_group_members')
        .select('group_id')
        .eq('user_id', userId);

      const merged: Record<string, boolean> = {};

      if (memberships && memberships.length > 0) {
        const groupIds = memberships.map((m: any) => m.group_id);
        const { data: groups } = await supabase
          .from('user_groups')
          .select('permissions')
          .in('id', groupIds);
        for (const g of (groups || [])) {
          const p = (g.permissions || {}) as Record<string, boolean>;
          if (p['all']) { setUserPermissions(null); return; }
          Object.entries(p).forEach(([k, v]) => { if (v) merged[k] = true; });
        }
      }

      // ── ۲. دسترسی از ساختار سازمانی ─────────────────────────────────────
      // پیدا کردن پست اصلی کاربر
      const { data: primaryMember } = await supabase
        .from('org_position_members')
        .select('position_id, org_positions(level)')
        .eq('user_id', userId)
        .eq('is_primary', true)
        .maybeSingle();

      if (primaryMember?.position_id) {
        const positionId = primaryMember.position_id;
        const posLevel = (primaryMember as any).org_positions?.level as number | undefined;

        // دسترسی‌های سطح سازمانی
        if (posLevel) {
          const { data: levelPerms } = await supabase
            .from('org_level_permissions')
            .select('permission_key, granted')
            .eq('level', posLevel);
          for (const p of (levelPerms || [])) {
            if (p.granted) merged[p.permission_key] = true;
            else delete merged[p.permission_key];
          }
        }

        // override دسترسی برای این پست خاص
        const { data: posPerms } = await supabase
          .from('org_position_permissions')
          .select('permission_key, granted')
          .eq('position_id', positionId);
        for (const p of (posPerms || [])) {
          if (p.granted) merged[p.permission_key] = true;
          else delete merged[p.permission_key];
        }
      }

      setUserPermissions(merged);
    } catch (err) {
      console.error('loadUserPermissions error:', err);
      setUserPermissions({});
    }
  };

  const checkAuth = async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Auth session error:", error);
        localStorage.removeItem('meeting-manager-auth');
        await supabase.auth.signOut();
        setIsAuthenticated(false);
        setLoading(false);
        return;
      }

      setIsAuthenticated(!!session);

      // If session exists but we want to verify it's still valid
      if (session) {
        try {
          const { data: { user }, error: userError } = await supabase.auth.getUser();
          if (userError || !user) {
            console.error("Auth user error:", userError);
            localStorage.removeItem('meeting-manager-auth');
            await supabase.auth.signOut();
            setIsAuthenticated(false);
          } else {
            setCurrentUserId(user.id);
            // Check if user is admin
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('is_admin')
              .eq('user_id', user.id)
              .maybeSingle();

            if (!profileError && profile) {
              const adminStatus = profile.is_admin === true;
              setIsAdmin(adminStatus);
              if (!adminStatus) {
                // Load merged permissions from all groups the user belongs to
                await loadUserPermissions(user.id);
              } else {
                setUserPermissions(null); // admin gets everything
              }
            } else {
              // Profile not found or error — grant no restriction so user isn't locked out
              await loadUserPermissions(user.id);
            }
          }
        } catch (userCheckError) {
          console.error("Error checking user:", userCheckError);
          localStorage.removeItem('meeting-manager-auth');
          await supabase.auth.signOut();
          setIsAuthenticated(false);
        }
      }
    } catch (error) {
      console.error("Auth check error:", error);
      localStorage.removeItem('meeting-manager-auth');
      handleSupabaseError(error);
      setIsAuthenticated(false);
      setUserPermissions({});
    } finally {
      setLoading(false);
    }
  };

  const fetchMeetings = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('meetings')
        .select(`
          *,
          participants (
            id,
            name
          ),
          actions (
            id,
            title,
            status,
            assignee
          )
        `)
        .eq('user_id', user.id)
        .neq('status', 'closed')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const formattedMeetings: Meeting[] = (data || []).map(meeting => ({
        id: meeting.id,
        subject: meeting.subject,
        requestDate: meeting.request_date,
        duration: meeting.duration,
        location: meeting.location,
        representative: meeting.representative,
        phone: meeting.phone,
        notes: meeting.notes,
        priority: meeting.priority,
        status: meeting.status,
        status_type: meeting.status_type || 'requested',
        participants: meeting.participants?.map((p: any) => p.name) || [],
        actions: meeting.actions || [],
        created_at: meeting.created_at,
        user_id: meeting.user_id,
        guest_emails: meeting.guest_emails || [],
        start_time: meeting.start_time || null,
        end_time: meeting.end_time || null,
        archived_participant_ids: meeting.archived_participant_ids || null,
      }));

      setMeetings(formattedMeetings);
      
      // Fetch pending meetings count
      fetchPendingMeetingsCount();
    } catch (error: any) {
      const handledError = handleSupabaseError(error);
      toast.error(handledError.message);
    }
  };
  
  const fetchPendingMeetingsCount = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { count, error } = await supabase
        .from('shared_meetings')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', user.id)
        .eq('status', 'pending');
      
      if (error) throw error;
      
      setPendingMeetingsCount(count || 0);
    } catch (error) {
      console.error('Error fetching pending meetings count:', error);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchMeetings();

    const channel = supabase
      .channel('app-meetings-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meetings' }, () => fetchMeetings())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => fetchMeetings())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'actions' }, () => fetchMeetings())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_meetings' }, () => {
        fetchMeetings();
        fetchPendingMeetingsCount();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isAuthenticated]);

  // Check if URL has /admin and redirect to admin page
  useEffect(() => {
    const checkAdminPath = () => {
      const path = window.location.pathname;
      if (path.includes('/admin')) {
        if (isAuthenticated && isAdmin) {
          setActivePage('admin');
        } else if (isAuthenticated && !isAdmin) {
          // If authenticated but not admin, redirect to main page
          window.history.pushState({}, '', '/');
          toast.error('شما دسترسی به پنل ادمین ندارید');
        }
      }
    };
    
    checkAdminPath();
    
    // Add event listener for popstate to handle browser back/forward buttons
    window.addEventListener('popstate', checkAdminPath);
    
    return () => {
      window.removeEventListener('popstate', checkAdminPath);
    };
  }, [isAuthenticated, isAdmin]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AuthPage onSuccess={() => {
      // Show splash after login if enabled
      supabase.from('system_config').select('value').eq('section', 'appearance').eq('key', 'splash_enabled').maybeSingle().then(({ data }) => {
        const enabled = !data || data.value === 'true' || data.value === null;
        if (enabled && !sessionStorage.getItem('spark_splash_shown')) {
          sessionStorage.setItem('spark_splash_shown', '1');
          setShowSplash(true);
          setSplashDone(false);
        }
      }).catch(() => {});
      setIsAuthenticated(true);
      setActivePage('calendar');
    }} />;
  }

  // If admin page is active and user is admin, show admin dashboard
  if (activePage === 'admin' && isAdmin) {
    return <AdminDashboard />;
  }

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

  const toggleCreateForm = () => {
    setActivePage('create-meeting');
  };

  // Maps page IDs to permission keys. Pages not listed are always accessible.
  const PAGE_PERMISSION_KEY: Record<string, string> = {
    meetings: 'meetings',
    'create-meeting': 'meetings_create',
    calendar: 'calendar',
    chat: 'chat',
    channels: 'channels',
    'video-conference': 'video_conference',
    tasks: 'tasks',
    notes: 'notes',
    contacts: 'contacts',
    contacts_email: 'contacts',
    reports: 'reports',
  };

  // Returns true if the current user may access a given page/feature key.
  const hasPermission = (key: string): boolean => {
    if (isAdmin) return true;
    if (userPermissions === null) return true; // full access
    if (userPermissions === undefined) return false; // still loading
    return !!userPermissions[key];
  };

  const AccessDenied = () => (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center" dir="rtl">
      <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
        <Bell className="w-8 h-8 text-red-400" />
      </div>
      <h2 className="text-xl font-bold text-gray-800 dark:text-white">دسترسی محدود شده</h2>
      <p className="text-gray-500 dark:text-gray-400 max-w-sm text-sm">
        شما مجوز دسترسی به این بخش را ندارید. لطفاً با مدیر سیستم تماس بگیرید.
      </p>
      <button
        onClick={() => setActivePage('profile')}
        className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors"
      >
        بازگشت به پروفایل
      </button>
    </div>
  );

  const renderContent = () => {
    // While permissions are still loading, show a spinner instead of "access denied"
    if (userPermissions === undefined && !isAdmin) {
      return (
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
        </div>
      );
    }
    const permKey = PAGE_PERMISSION_KEY[activePage];
    if (permKey && !hasPermission(permKey)) return <AccessDenied />;

    switch (activePage) {
      case 'calendar':
        return <CalendarPage
          pendingSchedule={pendingSchedule}
          onScheduleComplete={() => { setPendingSchedule(null); fetchMeetings(); }}
          pendingMentionParticipants={chatMentionParticipants.length > 0 ? chatMentionParticipants : undefined}
          pendingMentionNotes={chatMeetingNotes || undefined}
          onPendingMentionConsumed={() => { setChatMentionParticipants([]); setChatMeetingNotes(''); }}
          initialView={(sparkCalendarView as any) || undefined}
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
                fetchMeetings();
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
        />;
      case 'reports':
        return <ReportsPage />;
      case 'notes':
        return <NotesPage />;
      case 'profile':
        return <ProfilePage />;
      case 'contacts':
        return <ContactsPage />;
      case 'contacts_email':
        return <ContactsPage />;
      case 'tutorial':
        return <TutorialPage onAskSpark={(cmd) => { setSparkExternalCommand(cmd); }} />;
      case 'spark':
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
      default:
        return (
          <>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
              <h2 className="text-2xl font-bold dark:text-white">مدیریت جلسات</h2>
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
                    onClick={toggleCreateForm}
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

            {/* Modal for Pending Meetings */}
            {showPendingMeetingsModal && (
              <PendingMeetingsModal 
                onClose={() => setShowPendingMeetingsModal(false)}
                onUpdate={() => {
                  fetchMeetings();
                  fetchPendingMeetingsCount();
                }}
              />
            )}
          </>
        );
    }
  };

  return (
    <PermissionsProvider isAdmin={isAdmin} userPermissions={userPermissions}>
      <GlobalCallProvider
        currentUserId={currentUserId}
        onNavigateToChat={() => setActivePage('chat')}
        onNavigateToChannels={() => setActivePage('channels')}
      >
        {showSplash && !splashDone && (
          <SplashScreen onDone={() => { setShowSplash(false); setSplashDone(true); }} />
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
        <Layout activePage={activePage} onPageChange={(p) => setActivePage(p as typeof activePage)} isAdmin={isAdmin} userPermissions={userPermissions} sparkVisible={sparkVisible}
        >
           {renderContent()}
        </Layout>
        {currentUserId && sparkVisible && (
          <SparkAssistant
            currentUserId={currentUserId}
            onNavigate={(page) => setActivePage(page as typeof activePage)}
            onSetCalendarView={(view) => { setSparkCalendarView(view); setActivePage('calendar'); }}
            onOpenMeetingForm={(prefill) => {
              setSparkMeetingPrefill(prefill);
              setActivePage('create-meeting');
            }}
            onOpenCalendarMeetingForm={(prefill) => {
              setSparkCalendarMeetingPrefill(prefill);
              setActivePage('calendar');
            }}
            onNavigateToDate={(jy, jm, jd, view) => {
              setSparkNavigateDate({ jy, jm, jd, view });
              setActivePage('calendar');
            }}
            externalCommand={sparkExternalCommand}
            onExternalCommandConsumed={() => setSparkExternalCommand(null)}
          />
        )}
      </GlobalCallProvider>
    </PermissionsProvider>
  );
}

export default App;