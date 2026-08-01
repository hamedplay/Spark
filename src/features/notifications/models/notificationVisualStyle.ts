export function getNotificationTypeBackground(
  type: string
): string {
  if (type === 'chat')
    return 'bg-teal-100 dark:bg-teal-900/40';
  if (
    type === 'meeting' ||
    type === 'calendar'
  )
    return 'bg-blue-100 dark:bg-blue-900/40';
  if (type === 'task')
    return 'bg-amber-100 dark:bg-amber-900/40';
  if (type === 'note')
    return 'bg-green-100 dark:bg-green-900/40';
  if (
    type === 'conference' ||
    type === 'video_conference'
  )
    return 'bg-rose-100 dark:bg-rose-900/40';
  if (type === 'minutes')
    return 'bg-indigo-100 dark:bg-indigo-900/40';
  if (type === 'decision')
    return 'bg-violet-100 dark:bg-violet-900/40';
  return 'bg-gray-100 dark:bg-gray-700';
}
