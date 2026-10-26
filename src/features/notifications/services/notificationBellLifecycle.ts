import type {
  AppNotification,
} from '../types/appNotification';
import type {
  NotificationRealtimeHandlers,
} from './notificationRealtime';

export interface StartNotificationBellLifecycleInput {
  userId: string;

  loadNotifications:
    (
      userId: string
    ) =>
      Promise<AppNotification[]>;

  subscribeToChanges:
    (
      userId: string,
      handlers:
        NotificationRealtimeHandlers
    ) => () => void;

  onLoadingChange:
    (loading: boolean) => void;

  onNotificationsLoaded:
    (
      notifications:
        AppNotification[]
    ) => void;

  onNotificationInserted:
    (
      notification:
        AppNotification
    ) => void;

  onNotificationUpdated:
    (
      notification:
        AppNotification
    ) => void;

  onNotificationDeleted?: (id: string) => void;

  onRealtimeSubscribed?:
    (
      reconnected: boolean
    ) => void;

  onRealtimeError?:
    (error: unknown) => void;

  onLoadError:
    (error: unknown) => void;
}

export function startNotificationBellLifecycle(
  input:
    StartNotificationBellLifecycleInput
): () => void {
  let disposed = false;
  let running = false;
  let pending = false;
  let initial = true;
  let snapshotEstablished = false;
  let newestCreatedAt = -Infinity;
  const seenIds = new Set<string>();
  const remember = (n: AppNotification) => {
    seenIds.add(n.id); newestCreatedAt = Math.max(newestCreatedAt, Date.parse(n.created_at) || 0);
    if (seenIds.size > 256) seenIds.delete(seenIds.values().next().value!);
  };
  let interval: ReturnType<typeof setInterval> | undefined;
  const deletedIds = new Set<string>();
  const changes = new Map<string, AppNotification | null>();
  const schedule = (ms: number) => {
    if (typeof window === 'undefined') return;
    if (interval !== undefined) clearInterval(interval);
    interval = setInterval(resume, ms);
  };
  const refresh = async () => {
    if (disposed) return;
    pending = true;
    if (running) return;
    running = true;
    try {
      while (pending && !disposed) {
        pending = false;
        changes.clear();
        try {
          const loaded = await input.loadNotifications(input.userId);
          if (disposed) return;
          // Preserve events received after the HTTP query started. Everything
          // else comes from the server, including deletions and the top-50 limit.
          const rows = new Map(loaded.filter(n => !deletedIds.has(n.id)).map(n => [n.id, n]));
          changes.forEach((n, id) => { if (n) rows.set(id, n); else rows.delete(id); });
          const snapshot = [...rows.values()].sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,50);
          // Catch missed inserts without replaying initial history, read rows,
          // already delivered events or older rows entering the fifty-row window.
          const incoming = snapshotEstablished ? snapshot.filter(n => !n.read && !seenIds.has(n.id) && Date.parse(n.created_at) >= newestCreatedAt) : [];
          snapshot.forEach(remember); snapshotEstablished = true;
          input.onNotificationsLoaded(snapshot);
          incoming.reverse().forEach(n => input.onNotificationInserted(n));
        } catch (error) { if (!disposed) input.onLoadError(error); }
        finally { if (!disposed && initial) { initial = false; input.onLoadingChange(false); } }
      }
    } finally { running = false; }
  };
  const resume = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') void refresh();
  };
  input.onLoadingChange(true);
  // Register first; SUBSCRIBED triggers another reconciliation to close the
  // gap between the initial HTTP snapshot and a working socket subscription.
  const unsubscribe = input.subscribeToChanges(input.userId, {
    onInsert: n => { if (!disposed) { if (running) changes.set(n.id,n); if (!seenIds.has(n.id)) { remember(n); input.onNotificationInserted(n); } } },
    onUpdate: n => { if (!disposed) { if (running) changes.set(n.id,n); input.onNotificationUpdated(n); } },
    onDelete: id => { if (!disposed) { deletedIds.add(id); if (running) changes.set(id,null); input.onNotificationDeleted?.(id); void refresh(); } },
    onInvalidated: refresh,
    onSubscribed: reconnected => {
      if (disposed) return;
      schedule(60_000); void refresh(); input.onRealtimeSubscribed?.(reconnected);
    },
    onError: error => { if (!disposed) { schedule(15_000); input.onRealtimeError?.(error); } },
  });
  void refresh();
  schedule(60_000);
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
  }
  return () => {
    if (disposed) return;
    disposed = true; pending = false;
    if (interval !== undefined) clearInterval(interval);
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    }
    unsubscribe();
  };
}
