import {
  useState,
  useEffect,
  useRef,
} from 'react';
import {
  Bell,
  BellRing,
} from 'lucide-react';

import type {
  PageId,
} from '../../../app/layout/types';
import { useNotificationBell } from '../hooks/useNotificationBell';
import {
  groupNotificationsByDate,
} from '../models/notificationCollection';
import { NotificationPanelContent } from './NotificationPanelContent';

export interface NotificationBellProps {
  onNavigate?: (
    page: PageId
  ) => void;
}

export function NotificationBell({
  onNavigate,
}: NotificationBellProps) {
  const [showPanel, setShowPanel] =
    useState(false);
  const panelRef =
    useRef<HTMLDivElement>(null);

  const {
    notifications,
    unreadCount,
    loading,
    handleNotificationClick,
    markAllAsRead,
  } = useNotificationBell(onNavigate);

  useEffect(() => {
    const handler = (
      e: MouseEvent
    ) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(
          e.target as Node
        )
      ) {
        setShowPanel(false);
      }
    };

    if (showPanel)
      document.addEventListener(
        'mousedown',
        handler
      );
    return () =>
      document.removeEventListener(
        'mousedown',
        handler
      );
  }, [showPanel]);

  const grouped =
    groupNotificationsByDate(
      notifications
    );

  return (
    <div
      className="relative"
      ref={panelRef}
    >
      <button
        onClick={() =>
          setShowPanel((v) => !v)
        }
        className="relative p-2 text-gray-600 hover:text-blue-500 transition-colors dark:text-gray-300 dark:hover:text-blue-400 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
      >
        {unreadCount > 0 ? (
          <>
            <BellRing
              className="w-5 h-5 text-blue-500 dark:text-blue-400"
              style={{
                animation:
                  'bellRing 1.2s ease-in-out infinite',
              }}
            />
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] min-w-[18px] h-[18px] flex items-center justify-center rounded-full font-bold px-0.5 shadow-sm">
              {unreadCount > 99
                ? '99+'
                : unreadCount}
            </span>
          </>
        ) : (
          <Bell className="w-5 h-5" />
        )}
      </button>

      {showPanel && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40 sm:hidden"
            onClick={() =>
              setShowPanel(false)
            }
          />

          <div
            className="fixed bottom-0 left-0 right-0 rounded-t-2xl z-50 overflow-hidden flex flex-col bg-white dark:bg-gray-800 shadow-2xl border border-gray-100 dark:border-gray-700 sm:hidden"
            style={{
              maxHeight: '90vh',
            }}
            dir="rtl"
          >
            <div className="flex justify-center pt-2.5 pb-0 flex-shrink-0">
              <div className="w-10 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
            </div>

            <NotificationPanelContent
              loading={loading}
              groups={grouped}
              unreadCount={unreadCount}
              notifications={notifications}
              onMarkAllAsRead={markAllAsRead}
              onClose={() =>
                setShowPanel(false)
              }
              onNotificationClick={(n) =>
                void handleNotificationClick(
                  n
                )
              }
            />
          </div>

          <div
            className="absolute left-0 top-full mt-2 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden flex-col hidden sm:flex"
            style={{
              width: '480px',
              maxHeight: '680px',
            }}
            dir="rtl"
          >
            <NotificationPanelContent
              loading={loading}
              groups={grouped}
              unreadCount={unreadCount}
              notifications={notifications}
              onMarkAllAsRead={markAllAsRead}
              onClose={() =>
                setShowPanel(false)
              }
              onNotificationClick={(n) =>
                void handleNotificationClick(
                  n
                )
              }
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
