import { X } from 'lucide-react';
import toast from 'react-hot-toast';

import type {
  PageId,
} from '../../../app/layout/types';
import type {
  AppNotification,
} from '../types/appNotification';
import {
  resolveNotificationToastPage,
} from '../navigation/notificationNavigation';
import {
  NotificationTypeIcon,
  NotificationAvatar,
} from '../components/NotificationVisuals';
import {
  getNotificationTypeBackground,
} from '../models/notificationVisualStyle';

export function showIncomingNotification(
  notification:
    AppNotification,
  onNavigate?: (
    page: PageId
  ) => void
): void {
  const hasSender = !!(
    notification.sender_name ||
    notification.sender_avatar_url
  );
  const targetPage =
    resolveNotificationToastPage(
      notification
    );

  toast.custom(
    (t) => (
      <div
        onClick={() => {
          toast.dismiss(t.id);
          if (onNavigate && targetPage)
            onNavigate(targetPage);
        }}
        className={`flex items-start gap-3 bg-white dark:bg-gray-800 shadow-lg rounded-2xl p-3 border border-gray-100 dark:border-gray-700 max-w-sm w-full transition-all cursor-pointer ${
          t.visible
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 -translate-y-2'
        }`}
        dir="rtl"
      >
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${getNotificationTypeBackground(
            notification.type
          )}`}
        >
          {hasSender ? (
            <NotificationAvatar
              url={notification.sender_avatar_url}
              name={notification.sender_name}
              size={40}
            />
          ) : (
            <NotificationTypeIcon
              type={notification.type}
              size={20}
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 dark:text-white leading-tight truncate">
            {notification.title}
          </p>
          {notification.sender_name &&
            notification.type ===
              'chat' && (
              <p className="text-[11px] text-teal-600 dark:text-teal-400 font-medium">
                {notification.sender_name}
              </p>
            )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2 leading-relaxed whitespace-pre-line">
            {notification.message}
          </p>
          {targetPage && (
            <p className="text-[10px] text-blue-500 dark:text-blue-400 mt-1 font-medium">
              برای رفتن کلیک کنید
            </p>
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
    Notification.permission ===
      'granted' &&
    document.visibilityState !==
      'visible'
  ) {
    const browserNotification =
      new window.Notification(
        notification.title,
        {
          body: notification.message,
          icon: '/logo_spark.png',
        }
      );

    browserNotification.onclick = () => {
      window.focus();
      if (onNavigate && targetPage)
        onNavigate(targetPage);
      browserNotification.close();
    };
  }
}
