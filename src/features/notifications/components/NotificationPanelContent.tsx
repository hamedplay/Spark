import {
  Bell,
  CheckCheck,
  X,
} from 'lucide-react';

import type {
  AppNotification,
  NotificationGroup,
} from '../types/appNotification';
import {
  formatNotificationTimeAgo,
} from '../models/notificationCollection';
import {
  getNotificationTypeBackground,
} from '../models/notificationVisualStyle';
import {
  NotificationTypeIcon,
  NotificationAvatar,
} from './NotificationVisuals';

export interface NotificationPanelContentProps {
  loading: boolean;

  groups: NotificationGroup[];

  unreadCount: number;

  notifications:
    AppNotification[];

  onMarkAllAsRead:
    () => void;

  onClose:
    () => void;

  onNotificationClick:
    (
      notification:
        AppNotification
    ) => void;
}

export function NotificationPanelContent({
  loading,
  groups,
  unreadCount,
  notifications,
  onMarkAllAsRead,
  onClose,
  onNotificationClick,
}: NotificationPanelContentProps) {
  return (
    <>
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Bell className="w-4 h-4 text-blue-500" />
          </div>
          <h3 className="font-bold text-gray-800 dark:text-white text-base">
            اعلان‌ها
          </h3>
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
              <CheckCheck className="w-3.5 h-3.5" />{' '}
              خواندن همه
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
            <p className="text-sm text-gray-400">
              در حال بارگذاری...
            </p>
          </div>
        ) : notifications.length ===
          0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              <Bell className="w-8 h-8 text-gray-300 dark:text-gray-600" />
            </div>
            <p className="text-sm text-gray-400 dark:text-gray-500 font-medium">
              اعلانی وجود ندارد
            </p>
            <p className="text-xs text-gray-300 dark:text-gray-600">
              اعلان‌های جدید اینجا نمایش
              داده می‌شوند
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="px-5 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 sticky top-0">
                <span className="text-[11px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                  {group.label}
                </span>
              </div>

              {group.items.map((n) => (
                <div
                  key={n.id}
                  onClick={() =>
                    onNotificationClick(
                      n
                    )
                  }
                  className={`flex gap-3.5 px-5 py-4 border-b border-gray-50 dark:border-gray-700/40 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors ${
                    !n.read
                      ? 'bg-blue-50/60 dark:bg-blue-900/10'
                      : ''
                  }`}
                >
                  {n.sender_name ||
                  n.sender_avatar_url ? (
                    <div className="relative flex-shrink-0 mt-0.5">
                      <NotificationAvatar
                        url={n.sender_avatar_url}
                        name={n.sender_name}
                        size={44}
                      />
                      <div
                        className={`absolute -bottom-0.5 -left-0.5 w-5 h-5 rounded-full flex items-center justify-center border-2 border-white dark:border-gray-800 ${getNotificationTypeBackground(
                          n.type
                        )}`}
                      >
                        <NotificationTypeIcon
                          type={n.type}
                          size={10}
                        />
                      </div>
                    </div>
                  ) : (
                    <div
                      className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 ${getNotificationTypeBackground(
                        n.type
                      )}`}
                    >
                      <NotificationTypeIcon
                        type={n.type}
                        size={22}
                      />
                    </div>
                  )}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug flex-1">
                        {n.title}
                      </p>
                      <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                        {!n.read && (
                          <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                        )}
                        <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap">
                          {formatNotificationTimeAgo(
                            n.created_at
                          )}
                        </span>
                      </div>
                    </div>

                    {n.sender_name &&
                      n.type ===
                        'chat' && (
                        <p className="text-xs text-teal-600 dark:text-teal-400 font-medium mb-1">
                          {n.sender_name}
                        </p>
                      )}

                    <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed whitespace-pre-line">
                      {n.message}
                    </p>
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
            {notifications.length}{' '}
            اعلان — آخرین ۵۰ اعلان
            نمایش داده می‌شود
          </p>
        </div>
      )}
    </>
  );
}
