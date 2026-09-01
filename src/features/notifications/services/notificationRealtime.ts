import { supabase } from '../../../lib/supabase';
import type {
  AppNotification,
} from '../types/appNotification';

export interface NotificationRealtimeHandlers {
  onInsert:
    (
      notification:
        AppNotification
    ) => void;

  onUpdate:
    (
      notification:
        AppNotification
    ) => void;

  onSubscribed?: (
    reconnected: boolean
  ) => void;

  onError?: (
    error: unknown
  ) => void;
}

const INITIAL_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 8_000;

export function subscribeToUserNotificationChanges(
  userId: string,
  handlers:
    NotificationRealtimeHandlers
): () => void {
  let disposed = false;
  let channel:
    ReturnType<typeof supabase.channel> | null =
      null;
  let reconnectTimer:
    ReturnType<typeof setTimeout> | null =
      null;
  let reconnectAttempt = 0;
  let hasSubscribed = false;
  let isSubscribed = false;

  const clearReconnectTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const removeCurrentChannel = () => {
    if (!channel) return;

    const currentChannel = channel;
    channel = null;
    isSubscribed = false;

    void supabase.removeChannel(
      currentChannel
    );
  };

  const scheduleReconnect = (
    immediate = false
  ) => {
    if (
      disposed ||
      reconnectTimer !== null
    ) {
      return;
    }

    const delayMs = immediate
      ? 0
      : Math.min(
          MAX_RECONNECT_DELAY_MS,
          INITIAL_RECONNECT_DELAY_MS *
            2 ** Math.min(
              reconnectAttempt,
              3
            )
        );

    reconnectAttempt += 1;

    reconnectTimer = setTimeout(
      () => {
        reconnectTimer = null;
        void connect();
      },
      delayMs
    );
  };

  const connect = async () => {
    if (disposed) return;

    clearReconnectTimer();
    removeCurrentChannel();

    try {
      // Make sure the Realtime socket uses the latest authenticated JWT.
      // This is especially important after token refresh / MFA step-up.
      await supabase.realtime.setAuth();
    } catch (error: unknown) {
      if (!disposed) {
        handlers.onError?.(error);
      }
    }

    if (disposed) return;

    const nextChannel = supabase
      .channel(
        `notifications-bell-${userId}`
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (
            disposed ||
            !payload.new
          ) {
            return;
          }

          handlers.onInsert(
            payload.new as AppNotification
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (
            disposed ||
            !payload.new
          ) {
            return;
          }

          handlers.onUpdate(
            payload.new as AppNotification
          );
        }
      );

    channel = nextChannel;

    nextChannel.subscribe(
      (status, error) => {
        if (
          disposed ||
          channel !== nextChannel
        ) {
          return;
        }

        if (
          status === 'SUBSCRIBED'
        ) {
          const reconnected =
            hasSubscribed;

          hasSubscribed = true;
          isSubscribed = true;
          reconnectAttempt = 0;

          handlers.onSubscribed?.(
            reconnected
          );
          return;
        }

        if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          isSubscribed = false;

          if (error) {
            handlers.onError?.(
              error
            );
          }

          scheduleReconnect();
        }
      }
    );
  };

  const ensureConnected = () => {
    if (
      disposed ||
      isSubscribed
    ) {
      return;
    }

    scheduleReconnect(true);
  };

  const refreshRealtimeAuthAndConnection =
    async () => {
      if (disposed) return;

      try {
        await supabase.realtime.setAuth();
      } catch (error: unknown) {
        if (!disposed) {
          handlers.onError?.(error);
        }
      }

      if (!isSubscribed) {
        ensureConnected();
      }
    };

  const handleOnline = () => {
    void refreshRealtimeAuthAndConnection();
  };

  const handleVisibilityChange = () => {
    if (
      document.visibilityState ===
      'visible'
    ) {
      void refreshRealtimeAuthAndConnection();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener(
      'online',
      handleOnline
    );
    document.addEventListener(
      'visibilitychange',
      handleVisibilityChange
    );
  }

  void connect();

  return () => {
    if (disposed) return;

    disposed = true;
    clearReconnectTimer();

    if (typeof window !== 'undefined') {
      window.removeEventListener(
        'online',
        handleOnline
      );
      document.removeEventListener(
        'visibilitychange',
        handleVisibilityChange
      );
    }

    removeCurrentChannel();
  };
}
