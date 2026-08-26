import {
  useState,
  useEffect,
} from 'react';
import toast from 'react-hot-toast';

import type {
  PageId,
} from '../../../app/layout/types';
import { getCurrentAuthUserId } from '../../auth';
import { setMinuteIdInUrl } from '../../../lib/minutesNavigation';
import type {
  AppNotification,
} from '../types/appNotification';
import {
  countUnreadNotifications,
  prependIncomingNotification,
  replaceUpdatedNotification,
  markNotificationReadLocally,
  markAllNotificationsReadLocally,
} from '../models/notificationCollection';
import {
  resolveNotificationClickPage,
} from '../navigation/notificationNavigation';
import {
  fetchUserNotifications,
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
          setUnreadCount(
            countUnreadNotifications(
              loaded
            )
          );
        },
        onNotificationInserted: (
          notification
        ) => {
          setNotifications(
            (previous) => {
              const updated =
                prependIncomingNotification(
                  previous,
                  notification
                );
              setUnreadCount(
                countUnreadNotifications(
                  updated
                )
              );
              return updated;
            }
          );

          showIncomingNotification(
            notification,
            onNavigate
          );
        },
        onNotificationUpdated: (
          notification
        ) => {
          setNotifications(
            (previous) => {
              const updated =
                replaceUpdatedNotification(
                  previous,
                  notification
                );
              setUnreadCount(
                countUnreadNotifications(
                  updated
                )
              );
              return updated;
            }
          );
        },
        onLoadError: (error) => {
          console.error(
            'NotificationBell fetch error:',
            error
          );
        },
      });

    return cleanup;
  }, [currentUserId, onNavigate]);

  const markAsRead = async (
    id: string
  ): Promise<void> => {
    const prevNotifications =
      notifications;

    setNotifications((prev) => {
      const updated =
        markNotificationReadLocally(
          prev,
          id
        );
      setUnreadCount(
        countUnreadNotifications(
          updated
        )
      );
      return updated;
    });

    try {
      await markNotificationAsRead(
        id,
        currentUserId
      );
    } catch {
      setNotifications(prevNotifications);
      setUnreadCount(
        countUnreadNotifications(
          prevNotifications
        )
      );
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
      toast.success(
        'همه اعلان‌ها خوانده شد'
      );
    } catch {
      setNotifications(prevNotifications);
      setUnreadCount(
        countUnreadNotifications(
          prevNotifications
        )
      );
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
