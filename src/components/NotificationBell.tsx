import { useState, useEffect, useRef } from 'react';
import {
  Bell, BellRing, CheckCheck, X,
  Calendar, MessageCircle, ClipboardList, FileText,
  Video, Users, Star,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { setMinuteIdInUrl } from '../lib/minutesNavigation';
import toast from 'react-hot-toast';

interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
  user_id?: string;
  sender_id?: string | null;
  sender_name?: string | null;
  sender_avatar_url?: string | null;
  action_url?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  minute_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

type PageId =
  | 'meetings'
  | 'create-meeting'
  | 'tasks'
  | 'reports'
  | 'notes'
  | 'profile'
  | 'contacts'
  | 'contacts_email'
  | 'calendar'
  | 'tutorial'
  | 'admin'
  | 'chat'
  | 'video-conference'
  | 'portal-config'
  | 'spark'
  | 'minutes-detail'
  | 'minutes-my-decisions';

const pageMap: Record<string, PageId> = {
  chat: 'chat',
  meeting: 'meetings',
  calendar: 'calendar',
  tasks: 'tasks',
  task: 'tasks',
  note: 'notes',
  notes: 'notes',
  conference: 'video-conference',
  video_conference: 'video-conference',
  minutes_approval_requested: 'minutes-detail',
  minutes_all_approved: 'minutes-detail',
  minutes_changes_requested: 'minutes-detail',
  minutes_resubmitted: 'minutes-detail',
  minutes_secretary_confirmed: 'minutes-detail',
  minutes_published: 'minutes-detail',
  decision_assigned: 'minutes-detail',
  decision_completed: 'minutes-my-decisions',
  decision_waiting_approval: 'minutes-my-decisions',
  decision_stopped: 'minutes-my-decisions',
};

// Map notification type → icon component + color
function TypeIcon({ type, size = 18 }: { type: string; size?: number }) {
  const s = size;
  const cls = 'flex-shrink-0';

  if (type === 'chat') return <MessageCircle size={s} className={`${cls} text-teal-500`} />;
  if (type === 'meeting' || type === 'calendar') return <Calendar size={s} className={`${cls} text-blue-500`} />;
  if (type === 'task') return <ClipboardList size={s} className={`${cls} text-amber-500`} />;
  if (type === 'note') return <FileText size={s} className={`${cls} text-green-500`} />;
  if (type === 'video_conference' || type === 'conference') return <Video size={s} className={`${cls} text-rose-500`} />;
  if (type === 'group') return <Users size={s} className={`${cls} text-sky-500`} />;
  if (type === 'star') return <Star size={s} className={`${cls} text-yellow-500`} />;

  return <Bell size={s} className={`${cls} text-gray-400`} />;
}

function TypeBg(type: string): string {
  if (type === 'chat') return 'bg-teal-100 dark:bg-teal-900/40';
  if (type === 'meeting' || type === 'calendar') return 'bg-blue-100 dark:bg-blue-900/40';
  if (type === 'task') return 'bg-amber-100 dark:bg-amber-900/40';
  if (type === 'note') return 'bg-green-100 dark:bg-green-900/40';
  if (type === 'conference' || type === 'video_conference') return 'bg-rose-100 dark:bg-rose-900/40';
  return 'bg-gray-100 dark:bg-gray-700';
}

function Avatar({
  url,
  name,
  size = 32,
}: {
  url?: string | null;
  name?: string | null;
  size?: number;
}) {
  const [imageError, setImageError] = useState(false);
  const initials = (name || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  if (url && !imageError) {
    return (
      <img
        src={url}
        alt={name || ''}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
        onError={() => setImageError(true)}
      />
    );
  }

  return (
    <div
      className="rounded-full flex items-center justify-center bg-gradient-to-br from-teal-500 to-teal-700 text-white font-bold flex-shrink-0 text-xs"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}

function timeAgo(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'همین الان';
    if (m < 60) return `${m} دقیقه پیش`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} ساعت پیش`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d} روز پیش`;
    return new Date(iso).toLocaleDateString('fa-IR');
  } catch {
    return '';
  }
}

// Show a rich toast for an incoming notification
function showRichToast(n: AppNotification, onNavigate?: (page: PageId) => void) {
  const hasSender = !!(n.sender_name || n.sender_avatar_url);
  const targetPage = n.action_url ? pageMap[n.action_url] : undefined;

  toast.custom(
    (t) => (
      <div
        onClick={() => {
          toast.dismiss(t.id);
          if (onNavigate && targetPage) onNavigate(targetPage);
        }}
        className={`flex items-start gap-3 bg-white dark:bg-gray-800 shadow-lg rounded-2xl p-3 border border-gray-100 dark:border-gray-700 max-w-sm w-full transition-all cursor-pointer ${
          t.visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
        }`}
        dir="rtl"
      >
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${TypeBg(n.type)}`}>
          {hasSender ? (
            <Avatar url={n.sender_avatar_url} name={n.sender_name} size={40} />
          ) : (
            <TypeIcon type={n.type} size={20} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight truncate">{n.title}</p>
          {n.sender_name && n.type === 'chat' && (
            <p className="text-[11px] text-teal-600 dark:text-teal-400 font-medium">{n.sender_name}</p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 leading-relaxed whitespace-pre-line">{n.message}</p>
          {targetPage && (
            <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-1 font-medium">برای رفتن کلیک کنید</p>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            toast.dismiss(t.id);
          }}
          className="p-1 text-gray-300 hover:text-gray-500 dark:hover:text-gray-200 flex-shrink-0"
        >
          <X size={14} />
        </button>
      </div>
    ),
    { duration: 6000 }
  );

  if (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted' &&
    document.visibilityState !== 'visible'
  ) {
    const browserNotification = new window.Notification(n.title, {
      body: n.message,
      icon: '/logo_spark.png',
    });

    browserNotification.onclick = () => {
      window.focus();
      if (onNavigate && targetPage) onNavigate(targetPage);
      browserNotification.close();
    };
  }
}

interface PanelContentProps {
  loading: boolean;
  grouped: { label: string; items: AppNotification[] }[];
  unreadCount: number;
  notifications: AppNotification[];
  onMarkAllAsRead: () => void;
  onClose: () => void;
  onNotificationClick: (n: AppNotification) => void;
}

function NotificationPanelContent({
  loading,
  grouped,
  unreadCount,
  notifications,
  onMarkAllAsRead,
  onClose,
  onNotificationClick,
}: PanelContentProps) {
  return (
    <>
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Bell className="w-4 h-4 text-blue-500" />
          </div>
          <h3 className="font-bold text-gray-800 dark:text-white text-base">اعلان‌ها</h3>
          {unreadCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full min-w-[22px] text-center">
              {unreadCount}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              onClick={onMarkAllAsRead}
              title="همه خوانده شد"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors font-medium"
            >
              <CheckCheck className="w-3.5 h-3.5" /> خواندن همه
            </button>
          )}

          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto flex-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            <p className="text-sm text-gray-400">در حال بارگذاری...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              <Bell className="w-8 h-8 text-gray-300 dark:text-gray-600" />
            </div>
            <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">اعلانی وجود ندارد</p>
            <p className="text-xs text-gray-300 dark:text-gray-600">اعلان‌های جدید اینجا نمایش داده می‌شوند</p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.label}>
              <div className="px-5 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 sticky top-0">
                <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                  {group.label}
                </span>
              </div>

              {group.items.map((n) => (
                <div
                  key={n.id}
                  onClick={() => onNotificationClick(n)}
                  className={`flex gap-3.5 px-5 py-4 border-b border-gray-50 dark:border-gray-700/40 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors ${
                    !n.read ? 'bg-blue-50/60 dark:bg-blue-900/10' : ''
                  }`}
                >
                  {n.sender_name || n.sender_avatar_url ? (
                    <div className="relative flex-shrink-0 mt-0.5">
                      <Avatar url={n.sender_avatar_url} name={n.sender_name} size={44} />
                      <div
                        className={`absolute -bottom-0.5 -left-0.5 w-5 h-5 rounded-full flex items-center justify-center border-2 border-white dark:border-gray-800 ${TypeBg(
                          n.type
                        )}`}
                      >
                        <TypeIcon type={n.type} size={10} />
                      </div>
                    </div>
                  ) : (
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${TypeBg(n.type)}`}>
                      <TypeIcon type={n.type} size={22} />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug flex-1">{n.title}</p>
                      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                        {!n.read && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
                        <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                          {timeAgo(n.created_at)}
                        </span>
                      </div>
                    </div>

                    {n.sender_name && n.type === 'chat' && (
                      <p className="text-xs text-teal-600 dark:text-teal-400 font-medium mb-1">{n.sender_name}</p>
                    )}

                    <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">{n.message}</p>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {notifications.length > 0 && (
        <div className="px-5 py-2.5 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <p className="text-center text-xs text-gray-400 dark:text-gray-500">
            {notifications.length} اعلان — آخرین ۵۰ اعلان نمایش داده می‌شود
          </p>
        </div>
      )}
    </>
  );
}

interface NotificationBellProps {
  onNavigate?: (page: PageId) => void;
}

export function NotificationBell({ onNavigate }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });
  }, []);

  const fetchNotifications = async (uid: string) => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const items = (data || []) as AppNotification[];
      setNotifications(items);
      setUnreadCount(items.filter((n) => !n.read).length);
    } catch (err) {
      console.error('NotificationBell fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!currentUserId) return;

    fetchNotifications(currentUserId);

    const channel = supabase
      .channel(`notifications-bell-${currentUserId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${currentUserId}`,
        },
        (payload) => {
          if (!payload.new) return;
          const n = payload.new as AppNotification;

          setNotifications((prev) => {
            if (prev.some((x) => x.id === n.id)) return prev;
            const updated = [n, ...prev].slice(0, 50);
            setUnreadCount(updated.filter((x) => !x.read).length);
            return updated;
          });

          showRichToast(n, onNavigate);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${currentUserId}`,
        },
        (payload) => {
          if (!payload.new) return;
          const n = payload.new as AppNotification;

          setNotifications((prev) => {
            const updated = prev.map((x) => (x.id === n.id ? n : x));
            setUnreadCount(updated.filter((x) => !x.read).length);
            return updated;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserId, onNavigate]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false);
      }
    };

    if (showPanel) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPanel]);

  const markAsRead = async (id: string) => {
    const prevNotifications = notifications;

    setNotifications((prev) => {
      const updated = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      setUnreadCount(updated.filter((n) => !n.read).length);
      return updated;
    });

    const query = supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', id);

    const { error } = currentUserId
      ? await query.eq('user_id', currentUserId)
      : await query;

    if (error) {
      setNotifications(prevNotifications);
      setUnreadCount(prevNotifications.filter((n) => !n.read).length);
      toast.error('خطا در بروزرسانی اعلان');
    }
  };

  const handleNotificationClick = async (n: AppNotification) => {
    if (!n.read) await markAsRead(n.id);

    const actionKey = n.action_url || n.type;
    const page = pageMap[actionKey];
    if (!page || !onNavigate) return;

    if (page === 'minutes-detail' && n.minute_id) {
      setMinuteIdInUrl(n.minute_id);
    }
    setShowPanel(false);
    onNavigate(page);
  };

  const markAllAsRead = async () => {
    if (!currentUserId) return;

    const prevNotifications = notifications;

    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0);

    const { error } = await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', currentUserId)
      .eq('read', false);

    if (error) {
      setNotifications(prevNotifications);
      setUnreadCount(prevNotifications.filter((n) => !n.read).length);
      toast.error('خطا در بروزرسانی اعلان‌ها');
      return;
    }

    toast.success('همه اعلان‌ها خوانده شد');
  };

  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  const getGroup = (iso: string) => {
    const d = new Date(iso).toDateString();
    if (d === today) return 'امروز';
    if (d === yesterday) return 'دیروز';
    return new Date(iso).toLocaleDateString('fa-IR');
  };

  const grouped: { label: string; items: AppNotification[] }[] = [];
  notifications.forEach((n) => {
    const label = getGroup(n.created_at);
    const last = grouped[grouped.length - 1];
    if (last && last.label === label) last.items.push(n);
    else grouped.push({ label, items: [n] });
  });

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setShowPanel((v) => !v)}
        className="relative p-2 text-gray-600 hover:text-blue-500 transition-colors dark:text-gray-300 dark:hover:text-blue-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        {unreadCount > 0 ? (
          <>
            <BellRing
              className="w-5 h-5 text-blue-500 dark:text-blue-400"
              style={{ animation: 'bellRing 1.2s ease-in-out infinite' }}
            />
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] min-w-[18px] h-[18px] flex items-center justify-center rounded-full font-bold px-0.5 shadow-sm">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          </>
        ) : (
          <Bell className="w-5 h-5" />
        )}
      </button>

      {showPanel && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40 sm:hidden" onClick={() => setShowPanel(false)} />

          <div
            className="fixed bottom-0 left-0 right-0 rounded-t-2xl z-50 overflow-hidden flex flex-col bg-white dark:bg-gray-800 shadow-2xl border border-gray-100 dark:border-gray-700 sm:hidden"
            style={{ maxHeight: '90vh' }}
            dir="rtl"
          >
            <div className="flex justify-center pt-2.5 pb-0 flex-shrink-0">
              <div className="w-10 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
            </div>

            <NotificationPanelContent
              loading={loading}
              grouped={grouped}
              unreadCount={unreadCount}
              notifications={notifications}
              onMarkAllAsRead={markAllAsRead}
              onClose={() => setShowPanel(false)}
              onNotificationClick={handleNotificationClick}
            />
          </div>

          <div
            className="absolute left-0 top-full mt-2 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden flex-col hidden sm:flex"
            style={{ width: '480px', maxHeight: '680px' }}
            dir="rtl"
          >
            <NotificationPanelContent
              loading={loading}
              grouped={grouped}
              unreadCount={unreadCount}
              notifications={notifications}
              onMarkAllAsRead={markAllAsRead}
              onClose={() => setShowPanel(false)}
              onNotificationClick={handleNotificationClick}
            />
          </div>
        </>
      )}

      <style>{`
        @keyframes bellRing {
          0%, 100% { transform: rotate(0deg); }
          10% { transform: rotate(12deg); }
          20% { transform: rotate(-10deg); }
          30% { transform: rotate(8deg); }
          40% { transform: rotate(-6deg); }
          50% { transform: rotate(4deg); }
          60% { transform: rotate(0deg); }
        }
      `}</style>
    </div>
  );
}
