import { supabase } from '../../../lib/supabase';
import type {
  AppNotification,
} from '../types/appNotification';

export async function fetchUserNotifications(
  userId: string
): Promise<AppNotification[]> {
  const {
    data,
    error,
  } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order(
      'created_at',
      {
        ascending: false,
      }
    )
    .limit(50);

  if (error) {
    throw error;
  }

  return (
    data ?? []
  ) as AppNotification[];
}

export async function fetchUnreadNotificationCount(
  userId: string
): Promise<number> {
  const {
    count,
    error,
  } = await supabase
    .from('notifications')
    .select('id', {
      count: 'exact',
      head: true,
    })
    .eq('user_id', userId)
    .eq('read', false);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

export async function markNotificationAsRead(
  notificationId: string,
  userId: string | null
): Promise<void> {
  const query = supabase
    .from('notifications')
    .update({
      read: true,
    })
    .eq(
      'id',
      notificationId
    );

  const { error } = userId
    ? await query.eq(
        'user_id',
        userId
      )
    : await query;

  if (error) {
    throw error;
  }
}

export async function markAllUserNotificationsAsRead(
  userId: string
): Promise<void> {
  const { error } =
    await supabase
      .from('notifications')
      .update({
        read: true,
      })
      .eq(
        'user_id',
        userId
      )
      .eq(
        'read',
        false
      );

  if (error) {
    throw error;
  }
}
