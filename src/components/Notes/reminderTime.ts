export function reminderDateTime(value: string | null) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return { date: '', time: '09:00' };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

export function quickNoteReminder(days: number, now = new Date()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setSeconds(0, 0);
  return date.toISOString();
}

export function validateNoteReminder(value: string | null, original: string | null = null, now = Date.now()) {
  if (value === null || value === original) return;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= now) {
    throw new Error('تاریخ و ساعت یادآوری باید در آینده باشد');
  }
}
