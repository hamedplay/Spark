import { normalizeClockTime, resolveMeetingDateGregorian } from '../../lib/minutesDate';

/** Meeting day and wall clock belong to Tehran, independently of the viewing device. */
export function meetingStartInstant(meeting: {
  request_date?: string | null;
  request_jalaali_date?: string | null;
  start_time?: string | null;
}): Date | null {
  const day = resolveMeetingDateGregorian(meeting.request_jalaali_date, meeting.request_date);
  const time = normalizeClockTime(meeting.start_time);
  if (!day || !time) return null;
  const instant = new Date(`${day}T${time}:00+03:30`);
  return Number.isFinite(instant.getTime()) ? instant : null;
}
