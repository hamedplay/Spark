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
}

export function subscribeToUserNotificationChanges(
  userId: string,
  handlers:
    NotificationRealtimeHandlers
): () => void {
  const channel = supabase
    .channel(
      `notifications-bell-${userId}-${Date.now()}`
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
        if (!payload.new) return;
        const notification =
          payload.new as AppNotification;
        handlers.onInsert(
          notification
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
        if (!payload.new) return;
        const notification =
          payload.new as AppNotification;
        handlers.onUpdate(
          notification
        );
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(
      channel
    );
  };
}
