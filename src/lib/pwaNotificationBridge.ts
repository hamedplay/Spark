import { supabase } from './supabase';

type NotificationRow = {
  id?: string;
  user_id?: string;
  title?: string | null;
  message?: string | null;
  action_url?: string | null;
  type?: string | null;
};

let activeUserId: string | null = null;
let removeChannel: (() => void) | null = null;

function isInstalledPwa(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

async function notificationsEnabled(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('notifications_enabled')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return true;
  return data?.notifications_enabled !== false;
}

async function showSystemNotification(row: NotificationRow): Promise<void> {
  if (!isInstalledPwa()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator)) return;

  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(row.title?.trim() || 'اسپارک', {
    body: row.message?.trim() || 'اعلان جدید',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: row.id ? `spark-notification-${row.id}` : undefined,
    data: {
      actionUrl: row.action_url || '/',
      notificationId: row.id || null,
      type: row.type || null,
    },
  });
}

async function subscribe(userId: string): Promise<void> {
  if (activeUserId === userId && removeChannel) return;
  removeChannel?.();
  removeChannel = null;
  activeUserId = userId;

  if (!(await notificationsEnabled(userId))) return;

  try {
    await supabase.realtime.setAuth();
  } catch {
    // The channel subscription below will surface an auth failure by not subscribing.
  }

  const channel = supabase
    .channel(`pwa-system-notifications-${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${userId}`,
      },
      payload => {
        if (!payload.new) return;
        void showSystemNotification(payload.new as NotificationRow);
      },
    )
    .subscribe();

  removeChannel = () => {
    void supabase.removeChannel(channel);
  };
}

export function startPwaNotificationBridge(): () => void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return () => {};

  let disposed = false;

  void supabase.auth.getUser().then(({ data }) => {
    if (!disposed && data.user) void subscribe(data.user.id);
  });

  const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
    if (disposed) return;
    if (session?.user?.id) {
      void subscribe(session.user.id);
    } else {
      removeChannel?.();
      removeChannel = null;
      activeUserId = null;
    }
  });

  return () => {
    disposed = true;
    authListener.subscription.unsubscribe();
    removeChannel?.();
    removeChannel = null;
    activeUserId = null;
  };
}
