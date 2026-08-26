import type {
  AppNotification,
  NotificationGroup,
} from '../types/appNotification';

export function countUnreadNotifications(
  notifications:
    readonly AppNotification[]
): number {
  return notifications.filter(
    (notification) =>
      !notification.read
  ).length;
}

export function prependIncomingNotification(
  notifications:
    readonly AppNotification[],
  incoming: AppNotification
): AppNotification[] {
  if (
    notifications.some(
      (item) =>
        item.id === incoming.id
    )
  ) {
    return [
      ...notifications,
    ] as AppNotification[];
  }

  return [
    incoming,
    ...notifications,
  ].slice(0, 50);
}

export function replaceUpdatedNotification(
  notifications:
    readonly AppNotification[],
  updated: AppNotification
): AppNotification[] {
  return notifications.map(
    (notification) =>
      notification.id === updated.id
        ? updated
        : notification
  );
}

export function markNotificationReadLocally(
  notifications:
    readonly AppNotification[],
  notificationId: string
): AppNotification[] {
  return notifications.map(
    (notification) =>
      notification.id ===
      notificationId
        ? {
            ...notification,
            read: true,
          }
        : notification
  );
}

export function markAllNotificationsReadLocally(
  notifications:
    readonly AppNotification[]
): AppNotification[] {
  return notifications.map(
    (notification) => ({
      ...notification,
      read: true,
    })
  );
}

export function formatNotificationTimeAgo(
  iso: string,
  nowMs: number = Date.now()
): string {
  try {
    const diff =
      nowMs -
      new Date(iso).getTime();

    const minutes =
      Math.floor(diff / 60000);

    if (minutes < 1) {
      return 'همین الان';
    }

    if (minutes < 60) {
      return `${minutes} دقیقه پیش`;
    }

    const hours =
      Math.floor(minutes / 60);

    if (hours < 24) {
      return `${hours} ساعت پیش`;
    }

    const days =
      Math.floor(hours / 24);

    if (days < 7) {
      return `${days} روز پیش`;
    }

    return new Date(
      iso
    ).toLocaleDateString('fa-IR');
  } catch {
    return '';
  }
}

export function groupNotificationsByDate(
  notifications:
    readonly AppNotification[],
  nowMs: number = Date.now()
): NotificationGroup[] {
  const today =
    new Date(nowMs).toDateString();

  const yesterday =
    new Date(
      nowMs - 86_400_000
    ).toDateString();

  const getGroup = (
    iso: string
  ): string => {
    const d =
      new Date(iso).toDateString();
    if (d === today) return 'امروز';
    if (d === yesterday)
      return 'دیروز';
    return new Date(
      iso
    ).toLocaleDateString('fa-IR');
  };

  const grouped: NotificationGroup[] =
    [];

  notifications.forEach((n) => {
    const label = getGroup(
      n.created_at
    );
    const last =
      grouped[grouped.length - 1];
    if (last && last.label === label)
      last.items.push(n);
    else
      grouped.push({
        label,
        items: [n],
      });
  });

  return grouped;
}
