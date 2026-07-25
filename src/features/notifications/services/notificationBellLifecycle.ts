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

  onLoadError:
    (error: unknown) => void;
}

export function startNotificationBellLifecycle(
  input:
    StartNotificationBellLifecycleInput
): () => void {
  let disposed = false;

  input.onLoadingChange(true);

  void (async () => {
    try {
      const notifications =
        await input.loadNotifications(
          input.userId
        );

      if (disposed) {
        return;
      }

      input.onNotificationsLoaded(
        notifications
      );
    } catch (error: unknown) {
      if (disposed) {
        return;
      }

      input.onLoadError(error);
    } finally {
      if (!disposed) {
        input.onLoadingChange(false);
      }
    }
  })();

  const unsubscribe =
    input.subscribeToChanges(
      input.userId,
      {
        onInsert: (notification) => {
          if (!disposed) {
            input.onNotificationInserted(
              notification
            );
          }
        },

        onUpdate: (notification) => {
          if (!disposed) {
            input.onNotificationUpdated(
              notification
            );
          }
        },
      }
    );

  let cleanupDone = false;

  return () => {
    if (cleanupDone) return;
    cleanupDone = true;
    disposed = true;
    unsubscribe();
  };
}
