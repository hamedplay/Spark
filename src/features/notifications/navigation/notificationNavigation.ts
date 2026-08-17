import type {
  PageId,
} from '../../../app/layout/types';
import type {
  AppNotification,
} from '../types/appNotification';

export const NOTIFICATION_PAGE_MAP:
  Readonly<
    Record<string, PageId>
  > = {
  chat: 'chat',

  meeting: 'meetings',
  calendar: 'calendar',

  tasks: 'tasks',
  task: 'tasks',

  note: 'notes',
  notes: 'notes',

  conference:
    'video-conference',

  video_conference:
    'video-conference',

  minutes_approval_requested:
    'minutes-detail',

  minutes_all_approved:
    'minutes-detail',

  minutes_changes_requested:
    'minutes-detail',

  minutes_resubmitted:
    'minutes-detail',

  minutes_secretary_confirmed:
    'minutes-detail',

  minutes_published:
    'minutes-detail',

  decision_assigned:
    'minutes-detail',

  decision_completed:
    'minutes-detail',

  decision_waiting_approval:
    'minutes-detail',

  decision_stopped:
    'minutes-detail',
};

export function resolveNotificationClickPage(
  notification:
    AppNotification
): PageId | undefined {
  const actionKey =
    notification.action_url ||
    notification.template_event_type ||
    notification.type;

  return NOTIFICATION_PAGE_MAP[
    actionKey
  ];
}

export function resolveNotificationToastPage(
  notification:
    AppNotification
): PageId | undefined {
  return notification.action_url
    ? NOTIFICATION_PAGE_MAP[
        notification.action_url
      ]
    : undefined;
}
