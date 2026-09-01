import { useEffect, useRef, useState } from 'react';
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
import {
  getNotificationSwipeDecision,
} from '../models/notificationSwipeGesture';

const SWIPE_AXIS_START_PX = 6;
const HORIZONTAL_AXIS_RATIO = 1.05;
const VERTICAL_AXIS_RATIO = 1.15;
const DISMISS_ANIMATION_MS = 160;
const IN_APP_NOTIFICATION_DURATION_MS = 6000;
const NEXT_TOAST_DELAY_MS = 180;

type GestureAxis =
  | 'pending'
  | 'horizontal'
  | 'vertical';

interface GestureState {
  pointerId: number | null;
  startX: number;
  startY: number;
  startedAt: number;
  axis: GestureAxis;
}

interface IncomingNotificationToastProps {
  notification: AppNotification;
  visible: boolean;
  onDismiss: () => void;
  targetPage: PageId | undefined;
  onNavigate?: (
    page: PageId
  ) => void;
}

function IncomingNotificationToast({
  notification,
  visible,
  onDismiss,
  targetPage,
  onNavigate,
}: IncomingNotificationToastProps) {
  const gestureRef = useRef<GestureState>({
    pointerId: null,
    startX: 0,
    startY: 0,
    startedAt: 0,
    axis: 'pending',
  });
  const suppressClickRef = useRef(false);
  const dismissTimerRef =
    useRef<number | null>(null);

  const [dragX, setDragX] = useState(0);
  const [isDragging, setIsDragging] =
    useState(false);
  const [isDismissing, setIsDismissing] =
    useState(false);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null) {
        window.clearTimeout(
          dismissTimerRef.current
        );
      }
    };
  }, []);

  const hasSender = !!(
    notification.sender_name ||
    notification.sender_avatar_url
  );

  const resetGesture = (
    keepClickSuppressed = false
  ) => {
    gestureRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      startedAt: 0,
      axis: 'pending',
    };
    setIsDragging(false);
    setDragX(0);

    if (!keepClickSuppressed) {
      suppressClickRef.current = false;
    }
  };

  const releasePointer = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    try {
      if (
        event.currentTarget.hasPointerCapture(
          event.pointerId
        )
      ) {
        event.currentTarget.releasePointerCapture(
          event.pointerId
        );
      }
    } catch {
      // Losing capture during native mobile scrolling is harmless.
    }
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    if (
      event.pointerType === 'mouse' ||
      !event.isPrimary ||
      isDismissing
    ) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest('button')) {
      return;
    }

    gestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      axis: 'pending',
    };
    suppressClickRef.current = false;

    try {
      event.currentTarget.setPointerCapture(
        event.pointerId
      );
    } catch {
      // Pointer capture is an enhancement; touch-action still protects swipe.
    }
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const gesture = gestureRef.current;

    if (
      gesture.pointerId !== event.pointerId ||
      event.pointerType === 'mouse' ||
      isDismissing
    ) {
      return;
    }

    const deltaX =
      event.clientX - gesture.startX;
    const deltaY =
      event.clientY - gesture.startY;
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (gesture.axis === 'pending') {
      if (
        absX < SWIPE_AXIS_START_PX &&
        absY < SWIPE_AXIS_START_PX
      ) {
        return;
      }

      if (
        absY >
        absX * VERTICAL_AXIS_RATIO
      ) {
        gesture.axis = 'vertical';
        return;
      }

      if (
        absX >
        absY * HORIZONTAL_AXIS_RATIO
      ) {
        gesture.axis = 'horizontal';
        suppressClickRef.current = true;
        setIsDragging(true);
      } else {
        return;
      }
    }

    if (gesture.axis !== 'horizontal') {
      return;
    }

    setDragX(deltaX);
  };

  const dismissFromSwipe = (
    direction: -1 | 1
  ) => {
    suppressClickRef.current = true;
    gestureRef.current.pointerId = null;
    setIsDragging(false);
    setIsDismissing(true);

    const viewportWidth =
      typeof window !== 'undefined'
        ? window.innerWidth
        : 360;
    const offscreenDistance =
      Math.max(viewportWidth, 420);

    setDragX(
      direction * offscreenDistance
    );

    dismissTimerRef.current =
      window.setTimeout(() => {
        onDismiss();
      }, DISMISS_ANIMATION_MS);
  };

  const finishPointerGesture = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const gesture = gestureRef.current;

    if (
      gesture.pointerId !== event.pointerId
    ) {
      return;
    }

    releasePointer(event);

    const deltaX =
      event.clientX - gesture.startX;
    const deltaY =
      event.clientY - gesture.startY;

    if (gesture.axis === 'horizontal') {
      const durationMs =
        performance.now() -
        gesture.startedAt;
      const viewportWidth =
        typeof window !== 'undefined'
          ? window.innerWidth
          : 360;
      const decision =
        getNotificationSwipeDecision(
          deltaX,
          durationMs,
          viewportWidth
        );

      if (
        decision.dismiss &&
        decision.direction !== 0
      ) {
        dismissFromSwipe(
          decision.direction
        );
        return;
      }

      resetGesture(true);
      return;
    }

    if (
      gesture.axis === 'vertical' ||
      Math.abs(deltaY) >=
        SWIPE_AXIS_START_PX
    ) {
      suppressClickRef.current = true;
      resetGesture(true);
      return;
    }

    resetGesture();
  };

  const handlePointerCancel = (
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const gesture = gestureRef.current;
    if (
      gesture.pointerId !== event.pointerId
    ) {
      return;
    }

    releasePointer(event);
    resetGesture(
      gesture.axis !== 'pending'
    );
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
      onPointerCancel={handlePointerCancel}
      onClick={() => {
        if (
          isDismissing ||
          suppressClickRef.current
        ) {
          suppressClickRef.current = false;
          return;
        }

        onDismiss();
        if (onNavigate && targetPage) {
          onNavigate(targetPage);
        }
      }}
      className="flex items-start gap-3 bg-white dark:bg-gray-800 shadow-lg rounded-2xl p-3 border border-gray-100 dark:border-gray-700 max-w-sm w-full cursor-pointer"
      style={{
        width:
          'min(24rem, calc(100vw - 1.5rem))',
        maxWidth:
          'calc(100vw - 1.5rem)',
        boxSizing: 'border-box',
        opacity: isDismissing
          ? 0
          : visible
            ? dragOpacity
            : 0,
        transform: `translate3d(${dragX}px, ${visible || isDismissing ? 0 : -8}px, 0)`,
        transition: isDragging
          ? 'none'
          : 'transform 160ms cubic-bezier(0.22, 1, 0.36, 1), opacity 140ms ease',
        touchAction: 'pan-y pinch-zoom',
        overscrollBehaviorX: 'contain',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        willChange: 'transform, opacity',
      }}
      dir="rtl"
      role="status"
      aria-live="polite"
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
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          onDismiss();
        }}
        className="p-1 text-gray-300 hover:text-gray-500 dark:hover:text-gray-200 flex-shrink-0"
        aria-label="بستن اعلان"
      >
        <X size={14} />
      </button>
    </div>
  );
}

interface QueuedIncomingNotification {
  notification: AppNotification;
  onNavigate?: (
    page: PageId
  ) => void;
}

const incomingNotificationQueue:
  QueuedIncomingNotification[] = [];
const queuedNotificationIds =
  new Set<string>();

let activeIncomingNotificationId:
  string | null = null;
let activeIncomingToastId:
  string | null = null;
let activeAutoDismissTimer:
  number | null = null;
let nextToastTimer:
  number | null = null;

function clearActiveAutoDismissTimer(): void {
  if (
    activeAutoDismissTimer !== null &&
    typeof window !== 'undefined'
  ) {
    window.clearTimeout(
      activeAutoDismissTimer
    );
  }
  activeAutoDismissTimer = null;
}

function scheduleNextIncomingNotification(
  delayMs = 0
): void {
  if (
    activeIncomingNotificationId ||
    nextToastTimer !== null ||
    incomingNotificationQueue.length === 0 ||
    typeof window === 'undefined'
  ) {
    return;
  }

  const showNext = () => {
    nextToastTimer = null;

    if (
      activeIncomingNotificationId ||
      incomingNotificationQueue.length === 0
    ) {
      return;
    }

    const queued =
      incomingNotificationQueue.shift();
    if (!queued) return;

    const { notification, onNavigate } =
      queued;
    const targetPage =
      resolveNotificationToastPage(
        notification
      );

    activeIncomingNotificationId =
      notification.id;

    const toastId = toast.custom(
      (t) => (
        <IncomingNotificationToast
          notification={notification}
          visible={t.visible}
          onDismiss={() =>
            completeIncomingNotification(
              notification.id,
              t.id
            )
          }
          targetPage={targetPage}
          onNavigate={onNavigate}
        />
      ),
      {
        duration:
          IN_APP_NOTIFICATION_DURATION_MS +
          60_000,
      }
    );

    activeIncomingToastId = toastId;

    activeAutoDismissTimer =
      window.setTimeout(() => {
        completeIncomingNotification(
          notification.id,
          toastId
        );
      }, IN_APP_NOTIFICATION_DURATION_MS);
  };

  if (delayMs > 0) {
    nextToastTimer =
      window.setTimeout(
        showNext,
        delayMs
      );
  } else {
    showNext();
  }
}

function completeIncomingNotification(
  notificationId: string,
  toastId: string
): void {
  if (
    activeIncomingNotificationId !==
      notificationId ||
    activeIncomingToastId !== toastId
  ) {
    return;
  }

  clearActiveAutoDismissTimer();
  toast.dismiss(toastId);

  const finalize = () => {
    toast.remove(toastId);
    queuedNotificationIds.delete(
      notificationId
    );
    activeIncomingNotificationId = null;
    activeIncomingToastId = null;
    scheduleNextIncomingNotification();
  };

  if (typeof window === 'undefined') {
    finalize();
    return;
  }

  nextToastTimer = window.setTimeout(
    () => {
      nextToastTimer = null;
      finalize();
    },
    NEXT_TOAST_DELAY_MS
  );
}

function enqueueIncomingNotification(
  notification: AppNotification,
  onNavigate?: (
    page: PageId
  ) => void
): void {
  if (
    queuedNotificationIds.has(
      notification.id
    )
  ) {
    return;
  }

  queuedNotificationIds.add(
    notification.id
  );
  incomingNotificationQueue.push({
    notification,
    onNavigate,
  });
  scheduleNextIncomingNotification();
}

function showNativeBrowserNotification(
  notification: AppNotification,
  onNavigate?: (
    page: PageId
  ) => void
): void {
  const targetPage =
    resolveNotificationToastPage(
      notification
    );

  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    Notification.permission !==
      'granted' ||
    document.visibilityState ===
      'visible'
  ) {
    return;
  }

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
    if (onNavigate && targetPage) {
      onNavigate(targetPage);
    }
    browserNotification.close();
  };
}

export function resetIncomingNotificationQueue(): void {
  clearActiveAutoDismissTimer();

  if (
    nextToastTimer !== null &&
    typeof window !== 'undefined'
  ) {
    window.clearTimeout(nextToastTimer);
  }
  nextToastTimer = null;

  if (activeIncomingToastId) {
    toast.remove(activeIncomingToastId);
  }

  incomingNotificationQueue.length = 0;
  queuedNotificationIds.clear();
  activeIncomingNotificationId = null;
  activeIncomingToastId = null;
}

export function showIncomingNotification(
  notification:
    AppNotification,
  onNavigate?: (
    page: PageId
  ) => void
): void {
  // Native/background delivery remains immediate and independent from the
  // in-app presentation queue, so queueing never delays or drops the actual
  // notification signal.
  showNativeBrowserNotification(
    notification,
    onNavigate
  );

  // Foreground presentation is serialized: only one rich notification is
  // visible at a time while every distinct notification remains queued FIFO.
  enqueueIncomingNotification(
    notification,
    onNavigate
  );
}
