import { toEnglishDigits } from '../../lib/minutesDate';
import { formatMeetingRequestDate } from './formatMeetingRequestDate';

/** An absent date stays empty so SMS validation can reject it, never fabricate it. */
export function formatMeetingNotificationDate(meeting: {
  request_date?: string | null;
  request_jalaali_date?: string | null;
}): string {
  const date = formatMeetingRequestDate(meeting.request_date, meeting.request_jalaali_date);
  return date === '—' ? '' : toEnglishDigits(date);
}
