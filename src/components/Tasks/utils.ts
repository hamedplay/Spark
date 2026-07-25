import moment from 'moment-jalaali';
import { insertNotification } from '../../lib/notifications';
import { Task } from '../../types';

moment.loadPersian({ dialect: 'persian-modern', usePersianDigits: false });

export const toJalali = (iso: string) => moment(iso).format('jYYYY/jMM/jDD HH:mm');

export async function sendTaskNotification(
  recipientId: string,
  actorId: string,
  title: string,
  message: string,
  senderName?: string,
  senderAvatarUrl?: string,
  taskTitle?: string,
) {
  if (!recipientId) return;
  try {
    await insertNotification({
      userId: recipientId,
      category: 'task',
      eventType: 'assign',
      fallbackTitle: title,
      fallbackMessage: message,
      placeholders: { task_title: taskTitle || title, sender_name: senderName || '' },
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
