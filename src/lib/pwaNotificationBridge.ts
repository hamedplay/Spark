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
let pushSubscriptionReady = false;
let pushSubscriptionPromise: Promise<boolean> | null = null;

function isInstalledPwa(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches
    || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) output[i] = rawData.charCodeAt(i);
  return output;
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

async function disableLocalPushSubscription(): Promise<void> {
  pushSubscriptionReady = false;
  pushSubscriptionPromise = null;
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager?.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch {
    // Best effort on logout. A stale server endpoint is disabled on the next 404/410 response.
  }
}

async function ensurePushSubscription(userId: string): Promise<boolean> {
  if (!isInstalledPwa()) return false;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (!(await notificationsEnabled(userId))) return false;
  if (pushSubscriptionReady) return true;
  if (pushSubscriptionPromise) return pushSubscriptionPromise;

  pushSubscriptionPromise = (async () => {
    try {
      const { data: config, error: configError } = await supabase.functions.invoke('pwa-push-config', {
        body: {},
      });
      if (configError || typeof config?.publicKey !== 'string' || !config.publicKey) return false;

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(config.publicKey) as BufferSource,
        });
      }

      const serialized = subscription.toJSON();
      const endpoint = serialized.endpoint || subscription.endpoint;
      const p256dh = serialized.keys?.p256dh || '';
      const authKey = serialized.keys?.auth || '';
      if (!endpoint || !p256dh || !authKey) return false;

      const { error: saveError } = await supabase.rpc('upsert_my_pwa_push_subscription', {
        p_endpoint: endpoint,
        p_p256dh: p256dh,
        p_auth_key: authKey,
        p_user_agent: navigator.userAgent,
      });
      if (saveError) return false;

      pushSubscriptionReady = true;
      return true;
    } catch (error) {
      console.warn('PWA Web Push subscription failed:', error);
      return false;
    } finally {
      pushSubscriptionPromise = null;
    }
  })();

  return pushSubscriptionPromise;
}

async function showSystemNotification(row: NotificationRow): Promise<void> {
  if (!isInstalledPwa()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator)) return;

  // Once durable Web Push is registered, the server worker owns OS notifications.
  // Realtime remains subscribed for the app's own notification UI, but must not
  // produce a second system notification for the same event.
  if (pushSubscriptionReady) return;

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
  if (activeUserId === userId && removeChannel) {
    void ensurePushSubscription(userId);
    return;
  }
  removeChannel?.();
  removeChannel = null;
  activeUserId = userId;

  if (!(await notificationsEnabled(userId))) return;

  void ensurePushSubscription(userId);

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

  const handlePermissionChanged = () => {
    if (!disposed && activeUserId) void ensurePushSubscription(activeUserId);
  };
  window.addEventListener('pwa-notification-permission-changed', handlePermissionChanged);

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
      void disableLocalPushSubscription();
    }
  });

  return () => {
    disposed = true;
    window.removeEventListener('pwa-notification-permission-changed', handlePermissionChanged);
    authListener.subscription.unsubscribe();
    removeChannel?.();
    removeChannel = null;
    activeUserId = null;
    pushSubscriptionReady = false;
    pushSubscriptionPromise = null;
  };
}
