import { useRef, useState } from 'react';
import type {
  PointerEvent as ReactPointerEvent,
} from 'react';
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

const SWIPE_DISMISS_THRESHOLD_PX = 80;
const SWIPE_START_THRESHOLD_PX = 8;

interface IncomingNotificationToastProps {
  notification: AppNotification;
  toastId: string;
  visible: boolean;
  targetPage: PageId | null;
  onNavigate?: (
    page: PageId
  ) => void;
}

function IncomingNotificationToast({
  notification,
  toastId,
  visible,
  targetPage,
  onNavigate,
}: IncomingNotificationToastProps) {
  const startXRef = useRef<number | null>(
    null
  );
  const startYRef = useRef<number | null>(
    null
  );
  const suppressClickRef = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] =
    useState(false);

  const hasSender = !!(
    notification.sender_name ||
    notification.sender_avatar_url
  );

  const resetDrag = () => {
    startXRef.current = null;
    startYRef.current = null;
    setIsDragging(false);
    setDragX(0);
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (event.pointerType === 'mouse') {
      return;
    }

    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    suppressClickRef.current = false;
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (
      startXRef.current === null ||
      startYRef.current === null ||
      event.pointerType === 'mouse'
    ) {
      return;
    }

    const deltaX =
      event.clientX - startXRef.current;
    const deltaY =
      event.clientY - startYRef.current;

    if (!isDragging) {
      if (
        Math.abs(deltaX) <
          SWIPE_START_THRESHOLD_PX &&
        Math.abs(deltaY) <
          SWIPE_START_THRESHOLD_PX
      ) {
        return;
      }

      if (
        Math.abs(deltaY) >
        Math.abs(deltaX)
      ) {
        resetDrag();
        return;
      }

      setIsDragging(true);
      suppressClickRef.current = true;

      try {
        event.currentTarget.setPointerCapture(
          event.pointerId
        );
      } catch {
        // Pointer capture is optional; swipe still works without it.
      }
    }

    setDragX(deltaX);
  };

  const finishPointerGesture = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (startXRef.current === null) {
      return;
    }

    const deltaX =
      event.clientX - startXRef.current;

    if (
      suppressClickRef.current &&
      Math.abs(deltaX) >=
        SWIPE_DISMISS_THRESHOLD_PX
    ) {
      toast.dismiss(toastId);
      startXRef.current = null;
      startYRef.current = null;
      setIsDragging(false);
      setDragX(deltaX);
      return;
    }

    resetDrag();
  };

  const dragOpacity = Math.max(
    0.35,
    1 - Math.abs(dragX) / 220
  );

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerGesture}
      onPointerCancel={resetDrag}
      onClick={() => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }

        toast.dismiss(toastId);
        if (onNavigate && targetPage)
          onNavigate(targetPage);
      }}
      className="flex items-start gap-3 bg-white dark:bg-gray-800 shadow-lg rounded-2xl p-3 border border-gray-100 dark:border-gray-700 max-w-sm w-full cursor-pointer"
      style={{
        opacity: visible
          ? dragOpacity
          : 0,
        transform: `translate3d(${dragX}px, ${visible ? 0 : -8}px, 0)`,
        transition: isDragging
          ? 'none'
          : 'transform 180ms ease, opacity 180ms ease',
        touchAction: 'pan-y',
      }}
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
        onClick={(event) => {
          event.stopPropagation();
          toast.dismiss(toastId);
        }}
        className="p-1 text-gray-300 hover:text-gray-500 dark:hover:text-gray-200 flex-shrink-0"
        aria-label="بستن اعلان"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function showIncomingNotification(
  notification:
    AppNotification,
  onNavigate?: (
    page: PageId
  ) => void
): void {
  const targetPage =
    resolveNotificationToastPage(
      notification
    );

  toast.custom(
    (t) => (
      <IncomingNotificationToast
        notification={notification}
        toastId={t.id}
        visible={t.visible}
        targetPage={targetPage}
        onNavigate={onNavigate}
      />
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
