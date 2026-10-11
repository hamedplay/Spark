import { supabase } from './supabase';

type NotificationRow = {
  id?: string;
  user_id?: string;
  title?: string | null;
  message?: string | null;
  action_url?: string | null;
  type?: string | null;
};

type PushStatus =
  | 'unsupported'
  | 'not-installed'
  | 'permission-required'
  | 'permission-denied'
  | 'disabled-by-preference'
  | 'registering'
  | 'ready'
  | 'error';

let activeUserId: string | null = null;
let removeChannel: (() => void) | null = null;
let pushSubscriptionReady = false;
let pushSubscriptionPromise: Promise<boolean> | null = null;

function emitPushStatus(status: PushStatus, message?: string): void {
  window.dispatchEvent(new CustomEvent('pwa-push-status-changed', {
    detail: { status, message: message || null },
  }));
}

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

function sameApplicationServerKey(subscription: PushSubscription, expected: Uint8Array): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return true;
  const currentBytes = new Uint8Array(current);
  if (currentBytes.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i += 1) {
    if (currentBytes[i] !== expected[i]) return false;
  }
  return true;
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
  if (!isInstalledPwa()) {
    emitPushStatus('not-installed');
    return false;
  }
  if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    emitPushStatus('unsupported');
    return false;
  }
  if (Notification.permission === 'default') {
    emitPushStatus('permission-required');
    return false;
  }
  if (Notification.permission !== 'granted') {
    emitPushStatus('permission-denied');
    return false;
  }
  if (!(await notificationsEnabled(userId))) {
    emitPushStatus('disabled-by-preference');
    return false;
  }
  if (pushSubscriptionReady) {
    emitPushStatus('ready');
    return true;
  }
  if (pushSubscriptionPromise) return pushSubscriptionPromise;

  pushSubscriptionPromise = (async () => {
    emitPushStatus('registering');
    try {
      const { data: config, error: configError } = await supabase.functions.invoke('pwa-push-config', {
        body: {},
      });
      if (configError || typeof config?.publicKey !== 'string' || !config.publicKey) {
        throw new Error(configError?.message || 'PWA push configuration is unavailable');
      }

      const applicationServerKey = urlBase64ToUint8Array(config.publicKey);
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      // Push subscriptions are bound to the VAPID applicationServerKey. If the
      // backend key changed, re-create the browser subscription instead of
      // silently persisting an unusable endpoint.
      if (subscription && !sameApplicationServerKey(subscription, applicationServerKey)) {
        await subscription.unsubscribe();
        subscription = null;
      }

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as BufferSource,
        });
      }

      const serialized = subscription.toJSON();
      const endpoint = serialized.endpoint || subscription.endpoint;
      const p256dh = serialized.keys?.p256dh || '';
      const authKey = serialized.keys?.auth || '';
      if (!endpoint || !p256dh || !authKey) {
        throw new Error('Browser returned an incomplete push subscription');
      }

      const { error: saveError } = await supabase.rpc('upsert_my_pwa_push_subscription', {
        p_endpoint: endpoint,
        p_p256dh: p256dh,
        p_auth_key: authKey,
        p_user_agent: navigator.userAgent,
      });
      if (saveError) throw saveError;

      pushSubscriptionReady = true;
      emitPushStatus('ready');
      return true;
    } catch (error) {
      pushSubscriptionReady = false;
      const message = error instanceof Error ? error.message : String(error);
      console.warn('PWA Web Push subscription failed:', error);
      emitPushStatus('error', message);
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

  if (!(await notificationsEnabled(userId))) {
    emitPushStatus('disabled-by-preference');
    return;
  }

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
    pushSubscriptionReady = false;
    if (!disposed && activeUserId) void ensurePushSubscription(activeUserId);
  };
  const handleRetry = () => {
    pushSubscriptionReady = false;
    pushSubscriptionPromise = null;
    if (!disposed && activeUserId) void ensurePushSubscription(activeUserId);
  };
  window.addEventListener('pwa-notification-permission-changed', handlePermissionChanged);
  window.addEventListener('pwa-push-retry', handleRetry);

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
      emitPushStatus('not-installed');
      void disableLocalPushSubscription();
    }
  });

  return () => {
    disposed = true;
    window.removeEventListener('pwa-notification-permission-changed', handlePermissionChanged);
    window.removeEventListener('pwa-push-retry', handleRetry);
    authListener.subscription.unsubscribe();
    removeChannel?.();
    removeChannel = null;
    activeUserId = null;
    pushSubscriptionReady = false;
    pushSubscriptionPromise = null;
  };
}
