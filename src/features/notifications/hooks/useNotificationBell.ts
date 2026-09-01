import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import toast from 'react-hot-toast';

const UNREAD_COUNT_RECONCILE_INTERVAL_MS =
  5_000;

import type {
  PageId,
} from '../../../app/layout/types';
import { getCurrentAuthUserId } from '../../auth';
import { setMinuteIdInUrl } from '../../../lib/minutesNavigation';
import type {
  AppNotification,
} from '../types/appNotification';
import {
  prependIncomingNotification,
  reconcileNotificationSnapshot,
  replaceUpdatedNotification,
  markNotificationReadLocally,
  markAllNotificationsReadLocally,
} from '../models/notificationCollection';
import {
  resolveNotificationClickPage,
} from '../navigation/notificationNavigation';
import {
  fetchUserNotifications,
  fetchUnreadNotificationCount,
  markNotificationAsRead,
  markAllUserNotificationsAsRead,
} from '../repositories/notificationRepository';
import {
  subscribeToUserNotificationChanges,
} from '../services/notificationRealtime';
import {
  startNotificationBellLifecycle,
} from '../services/notificationBellLifecycle';
import {
  resetIncomingNotificationQueue,
  showIncomingNotification,
} from '../services/showIncomingNotification';

export interface UseNotificationBellResult {
  notifications:
    AppNotification[];

  unreadCount: number;
  loading: boolean;

  handleNotificationClick:
    (
      notification:
        AppNotification
    ) => Promise<boolean>;

  markAllAsRead:
    () => Promise<void>;
}

export function useNotificationBell(
  onNavigate?: (
    page: PageId
  ) => void
): UseNotificationBellResult {
  const [notifications, setNotifications] =
    useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] =
    useState(0);
  const [loading, setLoading] =
    useState(true);
  const [currentUserId, setCurrentUserId] =
    useState<string | null>(null);
  const onNavigateRef =
    useRef(onNavigate);
  const unreadCountRef =
    useRef(0);

  useEffect(() => {
    onNavigateRef.current =
      onNavigate;
  }, [onNavigate]);

  useEffect(() => {
    unreadCountRef.current =
      unreadCount;
  }, [unreadCount]);

  const refreshUnreadCount =
    useCallback(async (): Promise<
      number | null
    > => {
      if (!currentUserId) {
        unreadCountRef.current = 0;
        setUnreadCount(0);
        return 0;
      }

      try {
        const count =
          await fetchUnreadNotificationCount(
            currentUserId
          );

        unreadCountRef.current =
          count;
        setUnreadCount(count);
        return count;
      } catch (error: unknown) {
        console.error(
          'NotificationBell unread count error:',
          error
        );
        return null;
      }
    }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) return;

    let disposed = false;
    let running = false;

    const reconcileUnreadCount =
      async () => {
        if (
          disposed ||
          running ||
          document.visibilityState !==
            'visible'
        ) {
          return;
        }

        running = true;
        const previousCount =
          unreadCountRef.current;

        try {
          const count =
            await refreshUnreadCount();

          if (
            count !== null &&
            count !== previousCount
          ) {
            const loaded =
              await fetchUserNotifications(
                currentUserId
              );

            if (!disposed) {
              setNotifications(
                (previous) =>
                  reconcileNotificationSnapshot(
                    previous,
                    loaded
                  )
              );
            }
          }
        } catch (error: unknown) {
          console.error(
            'NotificationBell reconciliation error:',
            error
          );
        } finally {
          running = false;
        }
      };

    const intervalId =
      window.setInterval(
        () => {
          void reconcileUnreadCount();
        },
        UNREAD_COUNT_RECONCILE_INTERVAL_MS
      );

    const handleVisibilityChange =
      () => {
        if (
          document.visibilityState ===
          'visible'
        ) {
          void reconcileUnreadCount();
        }
      };

    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange
    );

    return () => {
      disposed = true;
      window.clearInterval(
        intervalId
      );
      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange
      );
    };
  }, [
    currentUserId,
    refreshUnreadCount,
  ]);

  useEffect(() => {
    return () => {
      resetIncomingNotificationQueue();
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      const userId =
        await getCurrentAuthUserId();
      if (!disposed && userId) {
        setCurrentUserId(userId);
      }
    })();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) return;

    let disposed = false;
    let unreadSyncTimer:
      number | null = null;

    const scheduleUnreadCountSync =
      () => {
        if (
          disposed ||
          unreadSyncTimer !== null
        ) {
          return;
        }

        unreadSyncTimer =
          window.setTimeout(
            () => {
              unreadSyncTimer = null;
              if (!disposed) {
                void refreshUnreadCount();
              }
            },
            80
          );
      };

    const cleanup =
      startNotificationBellLifecycle({
        userId: currentUserId,
        loadNotifications:
          fetchUserNotifications,
        subscribeToChanges:
          subscribeToUserNotificationChanges,
        onLoadingChange: setLoading,
        onNotificationsLoaded: (
          loaded
        ) => {
          setNotifications(loaded);
          scheduleUnreadCountSync();
        },
        onNotificationInserted: (
          notification
        ) => {
          setNotifications(
            (previous) =>
              prependIncomingNotification(
                previous,
                notification
              )
          );
          scheduleUnreadCountSync();

          showIncomingNotification(
            notification,
            (page) =>
              onNavigateRef.current?.(
                page
              )
          );
        },
        onNotificationUpdated: (
          notification
        ) => {
          setNotifications(
            (previous) =>
              replaceUpdatedNotification(
                previous,
                notification
              )
          );
          scheduleUnreadCountSync();
        },
        onRealtimeSubscribed: () => {
          void (async () => {
            try {
              const loaded =
                await fetchUserNotifications(
                  currentUserId
                );

              setNotifications(
                (previous) =>
                  reconcileNotificationSnapshot(
                    previous,
                    loaded
                  )
              );
              scheduleUnreadCountSync();
            } catch (error: unknown) {
              console.error(
                'NotificationBell realtime resync error:',
                error
              );
            }
          })();
        },
        onRealtimeError: (
          error
        ) => {
          console.error(
            'NotificationBell realtime error:',
            error
          );
        },
        onLoadError: (error) => {
          console.error(
            'NotificationBell fetch error:',
            error
          );
        },
      });

    return () => {
      disposed = true;

      if (
        unreadSyncTimer !== null
      ) {
        window.clearTimeout(
          unreadSyncTimer
        );
      }

      cleanup();
    };
  }, [
    currentUserId,
    refreshUnreadCount,
  ]);

  const markAsRead = async (
    id: string
  ): Promise<void> => {
    const prevNotifications =
      notifications;

    setNotifications((prev) =>
      markNotificationReadLocally(
        prev,
        id
      )
    );

    try {
      await markNotificationAsRead(
        id,
        currentUserId
      );
      void refreshUnreadCount();
    } catch {
      setNotifications(prevNotifications);
      void refreshUnreadCount();
      toast.error(
        'خطا در بروزرسانی اعلان'
      );
    }
  };

  const handleNotificationClick = async (
    n: AppNotification
  ): Promise<boolean> => {
    const page =
      resolveNotificationClickPage(n);

    if (!page || !onNavigate) {
      return false;
    }

    try {
      if (!n.read)
        await markAsRead(n.id);
    } catch {
      /* swallow mark-read errors so navigation still runs */
    }

    if (
      page === 'minutes-detail' &&
      n.minute_id
    ) {
      setMinuteIdInUrl(n.minute_id);
    }

    onNavigate(page);
    return true;
  };

  const markAllAsRead = async ():
    Promise<void> => {
    if (!currentUserId) return;

    const prevNotifications =
      notifications;

    setNotifications((prev) =>
      markAllNotificationsReadLocally(
        prev
      )
    );
    setUnreadCount(0);

    try {
      await markAllUserNotificationsAsRead(
        currentUserId
      );
      void refreshUnreadCount();
      toast.success(
        'همه اعلان‌ها خوانده شد'
      );
    } catch {
      setNotifications(prevNotifications);
      void refreshUnreadCount();
      toast.error(
        'خطا در بروزرسانی اعلان‌ها'
      );
    }
  };

  return {
    notifications,
    unreadCount,
    loading,
    handleNotificationClick,
    markAllAsRead,
  };
}
