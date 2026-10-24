import { toEnglishDigits } from '../../../lib/minutesDate';
import { formatMeetingRequestDate } from '../formatMeetingRequestDate';

interface ScheduledMeetingTiming {
  request_date?: string | null;
  request_jalaali_date?: string | null;
}

/** Keep the requested day separately while removing the calendar schedule. */
export function buildRevertedMeetingTiming(source: ScheduledMeetingTiming) {
  const requestedDay = formatMeetingRequestDate(source.request_date, source.request_jalaali_date);
  return {
    // Existing calendar queries use this timestamp: keep the reverted request off-calendar.
    request_date: null,
    request_jalaali_date: requestedDay === '—' ? null : toEnglishDigits(requestedDay),
    start_time: null,
    end_time: null,
    duration: null,
  };
}
