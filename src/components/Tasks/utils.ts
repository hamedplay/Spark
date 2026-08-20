import moment from 'moment-jalaali';
import { insertNotification } from '../../lib/notifications';
import { Task } from '../../types';

moment.loadPersian({ dialect: 'persian-modern', usePersianDigits: false });

export const toJalali = (iso: string) => moment(iso).format('jYYYY/jMM/jDD HH:mm');

export type TaskNotificationEventType =
  | 'assign'
  | 'complete'
  | 'note_added'
  | 'referred'
  | 'reminder'
  | 'status_in_progress'
  | 'status_pending';

export interface TaskNotificationOptions {
  eventType?: TaskNotificationEventType;
  placeholders?: Record<string, string>;
}

function inferTaskNotificationEventType(
  title: string,
  message: string,
): TaskNotificationEventType {
  if (!title.startsWith('تغییر وضعیت اقدام:')) return 'assign';
  if (message.includes('تکمیل شد')) return 'complete';
  if (message.includes('شروع شد')) return 'status_in_progress';
  if (message.includes('به حالت انتظار برگشت')) return 'status_pending';
  return 'assign';
}

export async function sendTaskNotification(
  recipientId: string,
  actorId: string,
  title: string,
  message: string,
  senderName?: string,
  senderAvatarUrl?: string,
  taskTitle?: string,
  options: TaskNotificationOptions = {},
) {
  if (!recipientId) return;
  try {
    await insertNotification({
      userId: recipientId,
      category: 'task',
      eventType: options.eventType ?? inferTaskNotificationEventType(title, message),
      fallbackTitle: title,
      fallbackMessage: message,
      placeholders: {
        task_title: taskTitle || title,
        sender_name: senderName || '',
        ...(options.placeholders || {}),
      },
      senderId: actorId || null,
      senderName: senderName || null,
      senderAvatarUrl: senderAvatarUrl || null,
      actionUrl: 'tasks',
    });
  } catch { /* non-critical — silently ignore */ }
}

export function getTaskRecipients(task: Task, _actorId?: string): string[] {
  const ids = new Set<string>();
  if (task.created_by_id) ids.add(task.created_by_id);
  if (task.current_assignee_id) ids.add(task.current_assignee_id);
  return Array.from(ids);
}
