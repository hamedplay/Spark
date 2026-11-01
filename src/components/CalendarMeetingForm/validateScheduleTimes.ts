/** A scheduled invitation must have an explicit start and end; never invent one. */
export function validateScheduleTimes(startTime: string, endTime: string): string | null {
  if (!startTime.trim()) return 'ساعت شروع جلسه را مشخص کنید.';
  if (!endTime.trim()) return 'ساعت پایان جلسه را مشخص کنید؛ بدون آن دعوت‌نامهٔ جلسه قابل ارسال نیست.';
  // Accept browser HH:mm and persisted PostgreSQL time strings, including seconds.
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?$/;
  if (!clock.test(startTime.trim()) || !clock.test(endTime.trim())) return 'ساعت شروع و پایان جلسه معتبر نیست.';
  return null;
}
